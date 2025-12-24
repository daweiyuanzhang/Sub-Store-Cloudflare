/**
 * 系统设置管理
 */

import { defaultSettings } from './settings-defaults.js';
import { getSystemSettingsRow, upsertSystemSettings } from './repos/settingsRepo.js';
import { debug } from '../utils/logger.js';

const SETTINGS_CACHE_TTL_MS = 30000;
let settingsCache = null;
let settingsCacheAt = 0;

/**
 * 获取系统设置
 * 如果数据库中没有某个 key，则从 defaultSettings 获取并自动保存
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function getSystemSettings(ctx) {
    if (settingsCache && Date.now() - settingsCacheAt < SETTINGS_CACHE_TTL_MS) {
        debug('[Settings] cache hit');
        return settingsCache;
    }

    const result = await getSystemSettingsRow(ctx);
    let dbSettings = {};

    try {
        dbSettings = JSON.parse(result?.settings || '{}');
    } catch (e) {
        dbSettings = {};
    }

    // 合并默认值，检查是否有缺失的 key
    let needsSave = false;
    const merged = { ...defaultSettings };

    for (const key of Object.keys(defaultSettings)) {
        if (key in dbSettings) {
            merged[key] = dbSettings[key];
        } else {
            // 缺失的 key，标记需要保存
            needsSave = true;
        }
    }

    // 保留数据库中存在但不在默认值中的 key
    for (const key of Object.keys(dbSettings)) {
        if (!(key in defaultSettings)) {
            merged[key] = dbSettings[key];
        }
    }

    // 如果有缺失的 key，自动保存到数据库
    if (needsSave) {
        await updateSystemSettings(ctx, merged);
    }

    settingsCache = merged;
    settingsCacheAt = Date.now();
    return merged;
}

/**
 * 获取单个设置项
 * @param {object} ctx
 * @param {string} key 
 * @returns {Promise<any>}
 */
export async function getSetting(ctx, key) {
    const settings = await getSystemSettings(ctx);
    return settings[key];
}

/**
 * 更新系统设置
 * @param {object} ctx
 * @param {object} settings 
 */
export async function updateSystemSettings(ctx, settings) {
    const json = JSON.stringify(settings);
    const now = Date.now();
    await upsertSystemSettings(ctx, json, now);
    settingsCache = settings;
    settingsCacheAt = Date.now();
}
