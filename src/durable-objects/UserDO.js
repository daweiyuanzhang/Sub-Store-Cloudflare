import { DurableObject } from 'cloudflare:workers';
import { Storage } from '@cloudflare/actors/storage';
import { setupGlobals } from '../core/globals.js';
import { handleSubStoreHttpRequest, handleSubStoreCronRequest } from '../core/substore.js';
import { getRequestId, initLogger, debug, error as logError } from '../utils/logger.js';
import { createIndexClient } from '../do/clients.js';
import { jsonResponse, errorResponse } from '../utils/response.js';
import { USER_ENDPOINTS } from '../do/endpoints.js';

const USER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);
`;

function extractAvatarUrl(userDataObj) {
    try {
        const subStoreStr = userDataObj?.['sub-store'];
        if (!subStoreStr) return '';
        const subStoreData = JSON.parse(subStoreStr);
        return subStoreData?.settings?.avatarUrl || '';
    } catch {
        return '';
    }
}

export class UserDO extends DurableObject {
    constructor(state, env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.storage = new Storage(state.storage);
        // 建表（多语句/DDL 直接走底层 sql.exec 更稳定）
        state.storage.sql.exec(USER_SCHEMA_SQL);
    }

    /**
     * 读取当前用户的整段 data（字符串形式）
     */
    #loadUserDataString() {
        const row = this.storage.sql`
            SELECT value
            FROM user_store
            WHERE key = ${'user_data'};
        `[0];
        return row?.value ?? '{}';
    }

    /**
     * 保存当前用户的整段 data（字符串形式）
     * 这里不做 JSON 校验，交由调用方保证写入内容可被 parse。
     */
    #saveUserDataString(userDataString) {
        this.storage.sql`
            INSERT OR REPLACE INTO user_store (key, value, updated_at)
            VALUES (${'user_data'}, ${userDataString}, ${Date.now()});
        `;
    }

    async #updateAvatarUrlIfNeeded(userId, userDataString) {
        let userDataObj = null;
        try {
            userDataObj = JSON.parse(userDataString || '{}');
        } catch {
            return;
        }
        const avatarUrl = extractAvatarUrl(userDataObj);

        // 只在 avatarUrl 发生变化时回写 IndexDO，减少不必要写入
        const prev = this.storage.sql`
            SELECT value
            FROM user_store
            WHERE key = ${'avatar_url'};
        `[0]?.value ?? '';
        if (prev === avatarUrl) {
            return;
        }
        this.storage.sql`
            INSERT OR REPLACE INTO user_store (key, value, updated_at)
            VALUES (${ 'avatar_url' }, ${ avatarUrl }, ${ Date.now() });
        `;

        const indexClient = createIndexClient(this.env);
        await indexClient.updateAvatar({ userId, avatarUrl });
    }

    async #saveDirtyUserData(userId) {
        if (globalThis.__user_data_dirty__ && globalThis.__user_data__) {
            const dataString = JSON.stringify(globalThis.__user_data__);
            this.#saveUserDataString(dataString);
            globalThis.__user_data_dirty__ = false;
            await this.#updateAvatarUrlIfNeeded(userId, dataString);
        }
    }

    async fetch(request) {
        // Durable Object 是独立 isolate，需要在 DO 内部也初始化 logger
        initLogger(this.env);

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        const headerUserId = request.headers.get('X-User-Id');
        const userId = parseInt(headerUserId || '0', 10) || 0;

        const requestId = getRequestId(request);
        debug(`[UserDO] [${requestId}] userId=${userId || 'unknown'} ${method} ${path}`);

        try {
            // ===== 内部接口：读写整段 user data =====
            if (path === USER_ENDPOINTS.USER_DATA && method === 'GET') {
                return jsonResponse({ data: this.#loadUserDataString() });
            }

            if (path === USER_ENDPOINTS.USER_DATA && method === 'PUT') {
                const body = await request.json();
                const dataString = JSON.stringify(body?.data ?? {});
                this.#saveUserDataString(dataString);
                if (userId) {
                    await this.#updateAvatarUrlIfNeeded(userId, dataString);
                }
                return jsonResponse({ ok: true });
            }

            if (path === USER_ENDPOINTS.USER_DATA && method === 'DELETE') {
                this.storage.sql`DELETE FROM user_store WHERE key = ${'user_data'};`;
                if (userId) {
                    await this.#updateAvatarUrlIfNeeded(userId, '{}');
                }
                return jsonResponse({ ok: true });
            }

            // ===== 内部接口：Cron 触发（每个用户串行）=====
            if (path === USER_ENDPOINTS.CRON && method === 'POST') {
                const username = request.headers.get('X-Username') || `user-${userId || 'unknown'}`;
                const role = request.headers.get('X-Role') || 'user';
                const userPath = request.headers.get('X-User-Path') || '';
                const userData = this.#loadUserDataString();
                const user = { id: userId, username, role, path: userPath, data: userData };

                const env = {
                    ...this.env,
                    // 让 Sub-Store 的持久化“落到 UserDO”，避免并发覆盖
                    __saveUserData: (id) => this.#saveDirtyUserData(id),
                };
                setupGlobals(env);
                await handleSubStoreCronRequest({ user, env });
                return jsonResponse({ ok: true });
            }

            // ===== Sub-Store HTTP 请求（每个用户串行，解决短时间多次写入丢失）=====
            const username = request.headers.get('X-Username') || `user-${userId || 'unknown'}`;
            const role = request.headers.get('X-Role') || 'user';
            const userPath = request.headers.get('X-User-Path') || '';
            const userData = this.#loadUserDataString();
            const user = { id: userId, username, role, path: userPath, data: userData };

            const ctx = { waitUntil: (p) => this.state.waitUntil(p) };
            const env = {
                ...this.env,
                __saveUserData: (id) => this.#saveDirtyUserData(id),
            };
            setupGlobals(env);
            const subStorePath = url.pathname + url.search;
            return await handleSubStoreHttpRequest({ user, env, ctx, request, subStorePath });
        } catch (err) {
            logError(`[UserDO] [${requestId}] unhandled error:`, err?.message || err);
            return errorResponse('Internal Server Error', 500);
        }
    }
}
