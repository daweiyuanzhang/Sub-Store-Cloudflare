import { DurableObject } from 'cloudflare:workers';
import { Storage } from '@cloudflare/actors/storage';
import { handleDashboardRequest } from '../dashboard/router.js';
import { getSystemSettings, updateSystemSettings } from '../dashboard/settings.js';
import { getRequestId, initLogger, debug, error as logError } from '../utils/logger.js';
import { createUserClient } from '../do/clients.js';
import { jsonResponse, errorResponse } from '../utils/response.js';
import { INDEX_ENDPOINTS } from '../do/endpoints.js';

const INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  path TEXT UNIQUE NOT NULL,
  notes TEXT DEFAULT '',
  token_version INTEGER DEFAULT 0,
  avatar_url TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_path ON users(path);

CREATE TABLE IF NOT EXISTS captchas (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captchas_expires ON captchas(expires_at);

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO system_settings (id, settings, updated_at) VALUES (1, '{}', (strftime('%s', 'now') * 1000));
`;

/**
 * IndexDO（全局 Durable Object）
 */
export class IndexDO extends DurableObject {
    constructor(state, env) {
        super(state, env);
        this.state = state;
        this.env = env;
        this.storage = new Storage(state.storage);
        // 建表（多语句 DDL 直接走底层 sql.exec，避免不同封装对多语句支持不一致）
        state.storage.sql.exec(INDEX_SCHEMA_SQL);
    }

    async fetch(request) {
        // Durable Object 是独立 isolate，需要在 DO 内部也初始化 logger
        initLogger(this.env);

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        const requestId = getRequestId(request);

        debug(`[IndexDO] [${requestId}] ${method} ${path}`);

        const baseCtx = { storage: this.storage };

        try {
            // ===== 内部接口：系统设置 =====
            if (path === INDEX_ENDPOINTS.SETTINGS && method === 'GET') {
                return jsonResponse(await getSystemSettings(baseCtx));
            }

            if (path === INDEX_ENDPOINTS.SETTINGS && method === 'POST') {
                const patch = await request.json();
                const current = await getSystemSettings(baseCtx);
                const next = { ...current, ...patch };
                await updateSystemSettings(baseCtx, next);
                return jsonResponse({ ok: true });
            }

            // ===== 内部接口：按 path 反查用户 =====
            if (path === INDEX_ENDPOINTS.USER_BY_PATH && method === 'GET') {
                const userPath = url.searchParams.get('path') || '';
                if (!userPath) return errorResponse('path required', 400);
                const row = this.storage.sql`
                    SELECT id, username, role, path
                    FROM users
                    WHERE path = ${userPath};
                `[0];
                if (!row) return errorResponse('Not Found', 404);
                return jsonResponse(row);
            }

            // ===== 内部接口：分页列出用户（Cron / 管理功能用）=====
            if (path === INDEX_ENDPOINTS.USERS_LIST && method === 'GET') {
                const afterId = parseInt(url.searchParams.get('afterId') || '0', 10) || 0;
                const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
                const results = this.storage.sql`
                    SELECT id, username, role, path
                    FROM users
                    WHERE id > ${afterId}
                    ORDER BY id
                    LIMIT ${limit};
                `;
                return jsonResponse({ results });
            }

            // ===== 内部接口：更新 avatar_url（UserDO 解析后回写索引）=====
            if (path === INDEX_ENDPOINTS.USERS_AVATAR && method === 'POST') {
                const body = await request.json();
                const userId = parseInt(body?.userId, 10);
                const avatarUrl = String(body?.avatarUrl || '');
                if (!userId) return errorResponse('userId required', 400);
                this.storage.sql`
                    UPDATE users
                    SET avatar_url = ${avatarUrl}, updated_at = ${Date.now()}
                    WHERE id = ${userId};
                `;
                return jsonResponse({ ok: true });
            }

            // ===== 内部接口：透传用户 data（给 dashboard 管理/编辑用）=====
            if (path === INDEX_ENDPOINTS.USER_DATA && method === 'GET') {
                const userId = parseInt(url.searchParams.get('userId') || '0', 10) || 0;
                if (!userId) return errorResponse('userId required', 400);
                const userClient = createUserClient(this.env, userId);
                const data = await userClient.getUserData({ id: userId }, requestId);
                return jsonResponse({ data });
            }

            if (path === INDEX_ENDPOINTS.USER_DATA && method === 'PUT') {
                const userId = parseInt(url.searchParams.get('userId') || '0', 10) || 0;
                if (!userId) return errorResponse('userId required', 400);
                const userClient = createUserClient(this.env, userId);
                const body = await request.json();
                const ok = await userClient.putUserData({ id: userId }, body?.data ?? {}, requestId);
                return jsonResponse({ ok });
            }

            // ===== Dashboard API：交给 dashboard/router 处理 =====
            if (path.startsWith('/api/dashboard')) {
                const userDataStore = {
                    get: async (userId) => {
                        const userClient = createUserClient(this.env, userId);
                        return await userClient.getUserData({ id: userId }, requestId);
                    },
                    put: async (userId, data) => {
                        const userClient = createUserClient(this.env, userId);
                        return await userClient.putUserData({ id: userId }, data, requestId);
                    },
                    delete: async (userId) => {
                        const userClient = createUserClient(this.env, userId);
                        return await userClient.deleteUserData({ id: userId }, requestId);
                    },
                };

                const ctx = { ...baseCtx, userDataStore };
                return handleDashboardRequest(request, { ...this.env, DB: ctx });
            }

            return new Response('Not Found', { status: 404 });
        } catch (err) {
            logError(`[IndexDO] [${requestId}] unhandled error:`, err?.message || err);
            return errorResponse('Internal Server Error', 500);
        }
    }
}
