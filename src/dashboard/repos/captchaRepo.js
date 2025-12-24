/**
 * 验证码 Repository（只负责 captchas 表）
 *
 * 约定：
 * - 入参 ctx: { storage: Storage }
 * - 这里不做任何业务逻辑（过期、次数限制等由 captcha.js 处理）
 */

/**
 * 删除过期验证码
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} now
 */
export async function deleteExpiredCaptchas(ctx, now) {
    ctx.storage.sql`DELETE FROM captchas WHERE expires_at < ${now};`;
    return { success: true };
}

/**
 * 插入验证码记录
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} id
 * @param {string} code
 * @param {number} expiresAt
 */
export async function insertCaptcha(ctx, id, code, expiresAt) {
    ctx.storage.sql`
        INSERT INTO captchas (id, code, attempts, expires_at)
        VALUES (${id}, ${code}, 0, ${expiresAt});
    `;
    return { success: true };
}

/**
 * 获取验证码（用于校验）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} id
 */
export async function getCaptchaForVerify(ctx, id) {
    return ctx.storage.sql`
        SELECT code, attempts, expires_at
        FROM captchas
        WHERE id = ${id};
    `[0] ?? null;
}

/**
 * 删除验证码
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} id
 */
export async function deleteCaptcha(ctx, id) {
    ctx.storage.sql`DELETE FROM captchas WHERE id = ${id};`;
    return { success: true };
}

/**
 * 自增尝试次数
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} id
 */
export async function incrementCaptchaAttempts(ctx, id) {
    ctx.storage.sql`UPDATE captchas SET attempts = attempts + 1 WHERE id = ${id};`;
    return { success: true };
}
