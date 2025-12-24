/**
 * 用户表 Repository（只负责 users 表）
 *
 * 约定：
 * - 入参 ctx: { storage: Storage }
 * - 这里不处理 UserDO 的整段 data（data 存在 UserDO），避免并发覆盖
 */

/**
 * 按用户名获取用户
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} username
 */
export async function getUserByUsername(ctx, username) {
    return ctx.storage.sql`SELECT * FROM users WHERE username = ${username};`[0] ?? null;
}

/**
 * 按 id 获取用户
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 */
export async function getUserById(ctx, id) {
    return ctx.storage.sql`SELECT * FROM users WHERE id = ${id};`[0] ?? null;
}

/**
 * 按 path 获取用户
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} path
 */
export async function getUserByPath(ctx, path) {
    return ctx.storage.sql`SELECT * FROM users WHERE path = ${path};`[0] ?? null;
}

/**
 * 统计用户数量（用于首次初始化 admin）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 */
export async function countUsers(ctx) {
    const row = ctx.storage.sql`SELECT COUNT(*) as count FROM users;`[0] ?? null;
    return row?.count ?? 0;
}

/**
 * 创建用户（不含 user data）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} username
 * @param {string} passwordHash
 * @param {'admin'|'user'} role
 * @param {string} path
 */
export async function createUser(ctx, username, passwordHash, role, path) {
    ctx.storage.sql`
        INSERT INTO users (username, password_hash, role, path)
        VALUES (${username}, ${passwordHash}, ${role}, ${path});
    `;
    return { success: true };
}

/**
 * 更新用户名
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 * @param {string} newUsername
 * @param {number} now
 */
export async function updateUsername(ctx, id, newUsername, now) {
    ctx.storage.sql`
        UPDATE users
        SET username = ${newUsername}, updated_at = ${now}
        WHERE id = ${id};
    `;
    return { success: true };
}

/**
 * 更新用户访问路径
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 * @param {string} newPath
 * @param {number} now
 */
export async function updatePath(ctx, id, newPath, now) {
    ctx.storage.sql`
        UPDATE users
        SET path = ${newPath}, updated_at = ${now}
        WHERE id = ${id};
    `;
    return { success: true };
}

/**
 * 更新用户备注
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 * @param {string} notes
 * @param {number} now
 */
export async function updateNotes(ctx, id, notes, now) {
    ctx.storage.sql`
        UPDATE users
        SET notes = ${notes}, updated_at = ${now}
        WHERE id = ${id};
    `;
    return { success: true };
}

/**
 * 更新密码并递增 token_version（使旧 Token 失效）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 * @param {string} passwordHash
 * @param {number} now
 */
export async function updatePasswordAndBumpTokenVersion(ctx, id, passwordHash, now) {
    ctx.storage.sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            token_version = token_version + 1,
            updated_at = ${now}
        WHERE id = ${id};
    `;
    return { success: true };
}

/**
 * 删除用户索引信息（UserDO 数据需要在上层同步删除）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {number} id
 */
export async function deleteUser(ctx, id) {
    ctx.storage.sql`DELETE FROM users WHERE id = ${id};`;
    return { success: true };
}

/**
 * 列出用户（管理员列表）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 */
export async function listUsersForAdmin(ctx) {
    return ctx.storage.sql`
        SELECT id, username, role, path, notes, avatar_url, created_at, updated_at
        FROM users;
    `;
}
