/**
 * 公开路由 - 无需认证
 * - 验证码
 * - 登录
 * - 公开设置
 */
import { jsonResponse, errorResponse } from '../utils/response.js';
import { signToken, getTokenExpiryHours } from '../auth.js';
import { hashPassword, verifyPassword } from '../password.js';
import { createCaptcha, verifyCaptcha } from '../captcha.js';
import { getUser, createUser } from '../user.js';
import { getSetting } from '../settings.js';

/**
 * 处理公开路由
 * @returns {Response|null} 如果匹配返回 Response，否则返回 null
 */
export async function handlePublicRoutes(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB;

    // GET /api/dashboard/captcha
    if (path === '/api/dashboard/captcha' && method === 'GET') {
        const captcha = await createCaptcha(db);
        return jsonResponse(captcha);
    }

    // GET /api/dashboard/settings/public - 公开设置
    if (path === '/api/dashboard/settings/public' && method === 'GET') {
        const frontendUrl = await getSetting(db, 'frontendUrl');
        return jsonResponse({ frontendUrl });
    }

    // POST /api/dashboard/auth/login
    if (path === '/api/dashboard/auth/login' && method === 'POST') {
        const { username, password, captchaId, captchaCode } = await request.json();
        const valid = await verifyCaptcha(db, captchaId, captchaCode);
        if (!valid) {
            return errorResponse('验证码错误或已过期');
        }

        let user = await getUser(db, username);

        // First time init: if no users, create admin
        if (!user && username === 'admin') {
            const countResult = await db.prepare('SELECT COUNT(*) as count FROM users').first();
            if (countResult.count === 0) {
                const hashedPassword = await hashPassword('admin');
                await createUser(db, 'admin', hashedPassword, 'admin');
                user = await getUser(db, 'admin');
            }
        }

        if (!user || !(await verifyPassword(password, user.password_hash))) {
            return errorResponse('用户名或密码错误', 401);
        }

        // 获取可配置的 Token 过期时间
        const expiryHours = await getTokenExpiryHours(db);
        const token = await signToken({
            id: user.id,
            username: user.username,
            role: user.role,
            tokenVersion: user.token_version || 0
        }, expiryHours);
        const frontendUrl = await getSetting(db, 'frontendUrl');
        return jsonResponse({ token, role: user.role, path: user.path, frontendUrl });
    }

    return null;
}
