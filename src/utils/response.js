/**
 * 通用响应工具（供 Durable Object / Worker 内部使用）
 * 注意：dashboard API 有自己的一套 CORS response 工具，不与这里混用。
 */

/**
 * JSON Response
 * @param {any} data
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...extraHeaders,
        },
    });
}

/**
 * JSON Error Response
 * @param {string} message
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 */
export function errorResponse(message, status = 400, extraHeaders = {}) {
    return jsonResponse({ error: message }, status, extraHeaders);
}

