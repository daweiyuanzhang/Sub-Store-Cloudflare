/**
 * 系统设置 Repository（只负责 system_settings 表）
 *
 * 约定：
 * - 入参 ctx: { storage: Storage }
 * - settings 字段存 JSON 字符串，业务层负责 merge 默认值/校验
 */

/**
 * 读取 system_settings 这一行（id=1）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 */
export async function getSystemSettingsRow(ctx) {
    return ctx.storage.sql`
        SELECT settings, updated_at
        FROM system_settings
        WHERE id = 1;
    `[0] ?? null;
}

/**
 * 写入/更新 system_settings（id=1）
 * @param {{ storage: import('@cloudflare/actors/storage').Storage }} ctx
 * @param {string} settingsJson
 * @param {number} now
 */
export async function upsertSystemSettings(ctx, settingsJson, now) {
    ctx.storage.sql`
        INSERT OR REPLACE INTO system_settings (id, settings, updated_at)
        VALUES (1, ${settingsJson}, ${now});
    `;
    return { success: true };
}
