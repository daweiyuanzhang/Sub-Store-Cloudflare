/**
 * Sub-Store Workers 入口文件 (Multi-Tenant)
 * 每个用户通过其专属路径访问独立的 Sub-Store
 */

// 初始化全局 polyfills（必须在 import Sub-Store 之前）
import './core/globals.js';

import { handleDashboardRequest } from './dashboard/router.js';
import { getUserByPath } from './dashboard/user.js';
import { setupGlobals } from './core/globals.js';
import { handleSubStoreHttpRequest, handleSubStoreCronRequest } from './core/substore.js';
import { handleCORS } from './core/request.js';
import { initLogger, info, error } from './utils/logger.js';
import { getSystemSettings, updateSystemSettings } from './dashboard/settings.js';

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

        const url = new URL(request.url);
        const pathSegments = url.pathname.split('/').filter(Boolean);

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return handleCORS();
        }

        // 1. Dashboard 路由 (优先)
        if (url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/api/dashboard')) {
            setupGlobals(env);
            return handleDashboardRequest(request, env);
        }

        // 2. 尝试匹配用户路径
        if (pathSegments.length === 0) {
            return new Response('Not Found', { status: 404 });
        }

        const userPath = pathSegments[0];
        const user = await getUserByPath(env.DB, userPath);

        if (!user) {
            return new Response('Not Found', { status: 404 });
        }

        // 3. 重写路径：去掉用户前缀
        const subStorePath = '/' + pathSegments.slice(1).join('/') + url.search;

        // 4. 处理 Sub-Store 请求
        return handleSubStoreHttpRequest({
            user,
            env,
            ctx,
            request,
            subStorePath,
        });
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
            const settings = await getSystemSettings(env.DB);
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

                const { results: users } = await env.DB
                    .prepare('SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?')
                    .bind(lastProcessedId, batchSize)
                    .all();

                if (!users || users.length === 0) {
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
                    await handleSubStoreCronRequest({ user, env });
                    processed += 1;
                    lastProcessedId = user.id;
                }
            }

            if (finishedAll) {
                settings.cronLastUserId = 0;
            } else if (lastProcessedId > 0) {
                settings.cronLastUserId = lastProcessedId;
            }

            await updateSystemSettings(env.DB, settings);

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
