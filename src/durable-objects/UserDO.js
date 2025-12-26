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

CREATE TABLE IF NOT EXISTS download_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  target TEXT,
  status INTEGER,
  path TEXT,
  ua TEXT,
  ip TEXT
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
        // 兼容旧表结构：补齐 status 字段
        this.#ensureAccessLogSchema();
    }

    #ensureAccessLogSchema() {
        try {
            const cols = this.storage.sql`PRAGMA table_info(download_access_log);`;
            const hasStatus = Array.isArray(cols) && cols.some((c) => c?.name === 'status');
            if (!hasStatus) {
                this.storage.sql`ALTER TABLE download_access_log ADD COLUMN status INTEGER;`;
            }
        } catch {
            // ignore
        }
    }

    #parseDownloadPath(pathname) {
        if (!pathname || typeof pathname !== 'string') return null;
        if (!pathname.startsWith('/download/')) return null;

        // /download/collection/:name(/:target)? ...
        if (pathname.startsWith('/download/collection/')) {
            const rest = pathname.slice('/download/collection/'.length);
            const segments = rest.split('/').filter(Boolean);
            const name = segments[0];
            if (!name) return null;
            const target = segments[1] && !segments[1].startsWith('api') ? segments[1] : null;
            return { kind: 'col', name, target };
        }

        // /download/:name(/:target)? ...
        const rest = pathname.slice('/download/'.length);
        const segments = rest.split('/').filter(Boolean);
        const name = segments[0];
        if (!name) return null;
        const target = segments[1] && !segments[1].startsWith('api') ? segments[1] : null;
        return { kind: 'sub', name, target };
    }

    #mergeTargets(pathTarget, queryTarget) {
        const t1 = (pathTarget || '').trim();
        const t2 = (queryTarget || '').trim();
        if (t2) {
            if (t1 && t1 !== t2) return `${t2} | ${t1}`;
            return t2;
        }
        return t1 || null;
    }

    #appendDownloadAccessLog({ ts, kind, name, target, status, path, ua, ip }) {
        this.storage.sql`
            INSERT INTO download_access_log (ts, kind, name, target, status, path, ua, ip)
            VALUES (${ts}, ${kind}, ${name}, ${target ?? null}, ${status ?? null}, ${path ?? null}, ${ua ?? null}, ${ip ?? null});
        `;

        // 简单的保留策略：最多保留最近 5000 条
        const MAX_ROWS = 5000;
        const maxId = this.storage.sql`SELECT MAX(id) AS maxId FROM download_access_log;`[0]?.maxId ?? 0;
        const cutoffId = maxId - MAX_ROWS;
        if (cutoffId > 0) {
            this.storage.sql`
                DELETE FROM download_access_log
                WHERE id <= ${cutoffId};
            `;
        }
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
            VALUES (${'avatar_url'}, ${avatarUrl}, ${Date.now()});
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
            // ===== 用户下载记录 =====
            // 记录“哪些订阅在什么时候被访问”，并附带 HTTP 状态码
            // 为减少噪音：默认只记录成功下载（200/304）
            const downloadMeta = (method === 'GET') ? this.#parseDownloadPath(path) : null;
            const downloadLogCandidate = downloadMeta
                ? {
                    ts: Date.now(),
                    kind: downloadMeta.kind,
                    name: downloadMeta.name,
                    target: this.#mergeTargets(downloadMeta.target, url.searchParams.get('target') || ''),
                    path: `${path}${url.search || ''}`,
                    ua: request.headers.get('User-Agent') || request.headers.get('user-agent') || '',
                    ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '',
                }
                : null;

            // GET /_internal/access-log?limit=50&beforeId=123
            // 仅供 Dashboard 后端代理调用（通过 /api/dashboard/... 鉴权）
            if (path === USER_ENDPOINTS.ACCESS_LOG && method === 'GET') {
                const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
                const beforeId = parseInt(url.searchParams.get('beforeId') || '0', 10) || 0;

                const rows = beforeId > 0
                    ? this.storage.sql`
                        SELECT id, ts, kind, name, target, status, path, ua, ip
                        FROM download_access_log
                        WHERE id < ${beforeId}
                        ORDER BY id DESC
                        LIMIT ${limit};
                    `
                    : this.storage.sql`
                        SELECT id, ts, kind, name, target, status, path, ua, ip
                        FROM download_access_log
                        ORDER BY id DESC
                        LIMIT ${limit};
                    `;

                const nextBeforeId = rows.length > 0 ? rows[rows.length - 1].id : null;
                return jsonResponse({ results: rows, nextBeforeId });
            }

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
            const resp = await handleSubStoreHttpRequest({ user, env, ctx, request, subStorePath });
            if (downloadLogCandidate) {
                const st = resp?.status ?? 0;
                if (st === 200 || st === 304) {
                    this.#appendDownloadAccessLog({ ...downloadLogCandidate, status: st });
                }
            }
            return resp;
        } catch (err) {
            logError(`[UserDO] [${requestId}] unhandled error:`, err?.message || err);
            return errorResponse('Internal Server Error', 500);
        }
    }
}
