/**
 * Sub-Store Workers 入口文件 (Multi-Tenant)
 * 每个用户通过其专属路径访问独立的 Sub-Store
 */

// 初始化全局 polyfills（必须在 import Sub-Store 之前）
import './core/globals.js';

import { handleCORS } from './core/request.js';
import { getRequestId, initLogger, info, error } from './utils/logger.js';
import { createIndexClient, createUserClient } from './do/clients.js';
export { IndexDO } from './durable-objects/IndexDO.js';
export { UserDO } from './durable-objects/UserDO.js';

function withRequestIdResponseHeader(response, requestId) {
    try {
        if (!response || !requestId) return response;
        if (response.headers?.get?.('X-Request-Id')) return response;
        const headers = new Headers(response.headers);
        headers.set('X-Request-Id', requestId);
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    } catch {
        return response;
    }
}

/**
 * Workers Export
 */
export default {
    /**
     * HTTP Fetch Handler
     */
    async fetch(request, env, ctx) {
        // 初始化日志模块
        initLogger(env);
        const requestId = getRequestId(request);

        const url = new URL(request.url);
        const pathSegments = url.pathname.split('/').filter(Boolean);
        const indexClient = createIndexClient(env);

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return withRequestIdResponseHeader(handleCORS(), requestId);
        }

        // 1. Dashboard 路由 (优先)
        if (url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/api/dashboard')) {
            if (url.pathname.startsWith('/api/dashboard')) {
                return withRequestIdResponseHeader(await indexClient.stub.fetch(request), requestId);
            }

            // 静态资源与 SPA 路由仍由 Worker 本身处理
            if (url.pathname.startsWith('/dashboard/assets/')) {
                return withRequestIdResponseHeader(await env.ASSETS.fetch(request), requestId);
            }
            // SPA：所有 /dashboard/* 返回 index.html
            const indexUrl = new URL(request.url);
            indexUrl.pathname = '/dashboard/index.html';
            return withRequestIdResponseHeader(await env.ASSETS.fetch(indexUrl.toString()), requestId);
        }

        // 2. 尝试匹配用户路径
        if (pathSegments.length === 0) {
            return withRequestIdResponseHeader(new Response('Not Found', { status: 404 }), requestId);
        }

        const userPath = pathSegments[0];
        const user = await indexClient.getUserByPath(userPath, requestId);

        if (!user) {
            return withRequestIdResponseHeader(new Response('Not Found', { status: 404 }), requestId);
        }

        // 3. 转发到用户 Durable Object（同一用户串行）
        const userClient = createUserClient(env, user.id);
        return withRequestIdResponseHeader(await userClient.forwardSubStoreRequest(request, user, requestId), requestId);
    },

    /**
     * Scheduled (Cron) Handler
     * 遍历所有用户执行定时任务
     */
    async scheduled(event, env, ctx) {
        // 初始化日志模块
        initLogger(env);
        info('[Cron] 开始执行定时任务...');

        try {
            const indexClient = createIndexClient(env);
            const settings = await indexClient.getSettings('cron');

            const batchSize = Math.max(1, parseInt(settings.cronBatchSize ?? 50, 10));
            const maxUsers = Math.max(0, parseInt(settings.cronMaxUsers ?? 200, 10));
            const timeBudgetMs = Math.max(1000, parseInt(settings.cronTimeBudgetMs ?? 20000, 10));
            let lastUserId = Math.max(0, parseInt(settings.cronLastUserId ?? 0, 10));

            let processed = 0;
            let lastProcessedId = lastUserId;
            let finishedAll = false;
            let stopReason = '';
            const startTime = Date.now();

            outer: while (true) {
                if (Date.now() - startTime > timeBudgetMs) {
                    stopReason = 'time-budget';
                    break;
                }

                const page = await indexClient.listUsers({ afterId: lastProcessedId, limit: batchSize }, 'cron');
                const users = page?.results || [];
                if (users.length === 0) {
                    finishedAll = true;
                    break;
                }

                for (const user of users) {
                    if (maxUsers > 0 && processed >= maxUsers) {
                        stopReason = 'max-users';
                        break outer;
                    }
                    if (Date.now() - startTime > timeBudgetMs) {
                        stopReason = 'time-budget';
                        break outer;
                    }

                    const userClient = createUserClient(env, user.id);
                    await userClient.cron(user, 'cron');

                    processed += 1;
                    lastProcessedId = user.id;
                }
            }

            if (finishedAll) {
                await indexClient.patchSettings({ cronLastUserId: 0 }, 'cron');
            } else if (lastProcessedId > 0) {
                await indexClient.patchSettings({ cronLastUserId: lastProcessedId }, 'cron');
            }

            if (stopReason === 'max-users') {
                info(`[Cron] 已达到本次最大处理上限: ${maxUsers}`);
            } else if (stopReason === 'time-budget') {
                info(`[Cron] 超出时间预算(${timeBudgetMs}ms)，提前结束`);
            }

            info(`[Cron] 定时任务执行完成，处理用户数: ${processed}`);
        } catch (err) {
            error('[Cron] 定时任务执行失败:', err.message);
        }
    },
};
