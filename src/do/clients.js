/**
 * Durable Objects 内部调用封装（轻量版）
 */

import { debug, setRequestIdHeader } from '../utils/logger.js';
import { stripFirstPathSegment } from '../core/request.js';
import { INDEX_ENDPOINTS, INDEX_ORIGIN, USER_ENDPOINTS, USER_ORIGIN } from './endpoints.js';

function buildUrl(origin, pathname, params) {
    const url = new URL(pathname, origin);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            url.searchParams.set(k, String(v));
        }
    }
    return url.toString();
}

function setUserHeaders(headers, user) {
    if (!headers) return;
    if (user?.id !== undefined && user?.id !== null) headers.set('X-User-Id', String(user.id));
    if (user?.username) headers.set('X-Username', user.username);
    if (user?.role) headers.set('X-Role', user.role);
    if (user?.path) headers.set('X-User-Path', user.path);
}

function withRequestId(init = {}, requestId) {
    const headers = new Headers(init.headers || {});
    setRequestIdHeader(headers, requestId);
    return { ...init, headers };
}

async function fetchJsonOrNull(stub, url, init, requestId) {
    const resp = await stub.fetch(url, withRequestId(init, requestId));
    if (!resp.ok) return null;
    return await resp.json();
}

/**
 * IndexDO Client
 * @param {any} env
 */
export function createIndexClient(env) {
    const id = env.INDEX_DO.idFromName('index');
    const stub = env.INDEX_DO.get(id);

    return {
        stub,

        async getSettings(requestId) {
            debug('[IndexClient] getSettings');
            return (
                (await fetchJsonOrNull(
                    stub,
                    buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.SETTINGS),
                    { method: 'GET' },
                    requestId
                )) || {}
            );
        },

        async patchSettings(patch, requestId) {
            debug('[IndexClient] patchSettings keys:', Object.keys(patch || {}));
            const resp = await stub.fetch(
                buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.SETTINGS),
                withRequestId(
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patch || {}),
                    },
                    requestId
                )
            );
            return resp.ok;
        },

        async getUserByPath(userPath, requestId) {
            debug('[IndexClient] getUserByPath:', userPath);
            const url = buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USER_BY_PATH, { path: userPath || '' });
            return await fetchJsonOrNull(stub, url, { method: 'GET' }, requestId);
        },

        async listUsers({ afterId = 0, limit = 200 } = {}, requestId) {
            debug('[IndexClient] listUsers:', { afterId, limit });
            const url = buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USERS_LIST, { afterId: afterId || 0, limit: limit || 200 });
            return (await fetchJsonOrNull(stub, url, { method: 'GET' }, requestId)) || { results: [] };
        },

        async updateAvatar({ userId, avatarUrl }, requestId) {
            debug('[IndexClient] updateAvatar:', userId);
            const resp = await stub.fetch(
                buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USERS_AVATAR),
                withRequestId(
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, avatarUrl }),
                    },
                    requestId
                )
            );
            return resp.ok;
        },

        async getUserData(userId, requestId) {
            debug('[IndexClient] getUserData:', userId);
            const url = buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USER_DATA, { userId: userId || 0 });
            const body = await fetchJsonOrNull(stub, url, { method: 'GET' }, requestId);
            return body?.data ?? null;
        },

        async putUserData(userId, data, requestId) {
            debug('[IndexClient] putUserData:', userId);
            const url = buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USER_DATA, { userId: userId || 0 });
            const resp = await stub.fetch(
                url,
                withRequestId(
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'X-User-Id': String(userId) },
                        body: JSON.stringify({ data }),
                    },
                    requestId
                )
            );
            return resp.ok;
        },

        async deleteUserData(userId, requestId) {
            debug('[IndexClient] deleteUserData:', userId);
            const url = buildUrl(INDEX_ORIGIN, INDEX_ENDPOINTS.USER_DATA, { userId: userId || 0 });
            const resp = await stub.fetch(
                url,
                withRequestId(
                    {
                        method: 'DELETE',
                        headers: { 'X-User-Id': String(userId) },
                    },
                    requestId
                )
            );
            return resp.ok;
        },
    };
}

/**
 * UserDO Client（按 userId 获取 stub）
 * @param {any} env
 * @param {number|string} userId
 */
export function createUserClient(env, userId) {
    const id = env.USER_DO.idFromName(String(userId));
    const stub = env.USER_DO.get(id);

    return {
        stub,

        async getUserData(user, requestId) {
            debug('[UserClient] getUserData:', user?.id);
            const headers = new Headers();
            setUserHeaders(headers, user);
            const body = await fetchJsonOrNull(
                stub,
                buildUrl(USER_ORIGIN, USER_ENDPOINTS.USER_DATA),
                { method: 'GET', headers },
                requestId
            );
            return body?.data ?? null;
        },

        async putUserData(user, data, requestId) {
            debug('[UserClient] putUserData:', user?.id);
            const headers = new Headers({ 'Content-Type': 'application/json' });
            setUserHeaders(headers, user);
            setRequestIdHeader(headers, requestId);
            const resp = await stub.fetch(buildUrl(USER_ORIGIN, USER_ENDPOINTS.USER_DATA), {
                method: 'PUT',
                headers,
                body: JSON.stringify({ data }),
            });
            return resp.ok;
        },

        async deleteUserData(user, requestId) {
            debug('[UserClient] deleteUserData:', user?.id);
            const headers = new Headers();
            setUserHeaders(headers, user);
            setRequestIdHeader(headers, requestId);
            const resp = await stub.fetch(buildUrl(USER_ORIGIN, USER_ENDPOINTS.USER_DATA), { method: 'DELETE', headers });
            return resp.ok;
        },

        async cron(user, requestId) {
            debug('[UserClient] cron:', user?.id);
            const headers = new Headers();
            setUserHeaders(headers, user);
            setRequestIdHeader(headers, requestId);
            const resp = await stub.fetch(buildUrl(USER_ORIGIN, USER_ENDPOINTS.CRON), { method: 'POST', headers });
            return resp.ok;
        },

        async getAccessLog(user, { limit = 50, beforeId = 0 } = {}, requestId) {
            debug('[UserClient] getAccessLog:', user?.id, { limit, beforeId });
            const headers = new Headers();
            setUserHeaders(headers, user);
            const url = buildUrl(USER_ORIGIN, USER_ENDPOINTS.ACCESS_LOG, {
                limit: limit || 50,
                beforeId: beforeId || undefined,
            });
            return (await fetchJsonOrNull(stub, url, { method: 'GET', headers }, requestId)) || { results: [], nextBeforeId: null };
        },

        /**
         * 把外部请求转发给 UserDO 的 Sub-Store 入口
         * - 自动去掉 url 的第一个 path segment（用户前缀）
         * - 自动补齐用户 headers
         */
        async forwardSubStoreRequest(request, user, requestId) {
            const url = new URL(request.url);
            const newUrl = new URL(request.url);
            newUrl.pathname = stripFirstPathSegment(url.pathname);
            newUrl.search = url.search;

            const forwardedRequest = new Request(newUrl.toString(), request);
            setUserHeaders(forwardedRequest.headers, user);
            setRequestIdHeader(forwardedRequest.headers, requestId);

            debug('[UserClient] forward:', { userId: user?.id, path: newUrl.pathname });
            return await stub.fetch(forwardedRequest);
        },
    };
}
