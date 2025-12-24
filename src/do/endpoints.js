/**
 * Durable Objects 内部 endpoint 常量
 * 集中管理，避免全项目散落字符串导致修改困难
 */

export const INDEX_ORIGIN = 'https://index';
export const USER_ORIGIN = 'https://user';

export const INDEX_ENDPOINTS = {
    SETTINGS: '/_internal/index/settings',
    USER_BY_PATH: '/_internal/index/user/by-path',
    USERS_LIST: '/_internal/index/users/list',
    USERS_AVATAR: '/_internal/index/users/avatar',
    USER_DATA: '/_internal/index/user-data',
};

export const USER_ENDPOINTS = {
    USER_DATA: '/_internal/user-data',
    CRON: '/_internal/cron',
};

