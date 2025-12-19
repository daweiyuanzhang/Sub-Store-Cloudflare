/**
 * 密码哈希工具
 * 使用 Web Crypto API 实现安全的密码存储
 */

/**
 * 生成随机盐值
 * @param {number} length - 盐值长度（字节）
 * @returns {string} - Base64 编码的盐值
 */
function generateSalt(length = 16) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
}

/**
 * 将字符串转换为 ArrayBuffer
 * @param {string} str 
 * @returns {ArrayBuffer}
 */
function stringToArrayBuffer(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

/**
 * 将 ArrayBuffer 转换为十六进制字符串
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function arrayBufferToHex(buffer) {
    const byteArray = new Uint8Array(buffer);
    return Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 哈希密码
 * 格式: $sha256$salt$hash
 * @param {string} password - 明文密码
 * @returns {Promise<string>} - 格式化的哈希字符串
 */
export async function hashPassword(password) {
    const salt = generateSalt();
    const saltedPassword = salt + password;
    const hashBuffer = await crypto.subtle.digest('SHA-256', stringToArrayBuffer(saltedPassword));
    const hash = arrayBufferToHex(hashBuffer);
    return `$sha256$${salt}$${hash}`;
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} storedHash - 存储的哈希字符串
 * @returns {Promise<boolean>} - 是否匹配
 */
export async function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.startsWith('$sha256$')) {
        return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 4) {
        return false;
    }

    const [, algorithm, salt, hash] = parts;
    if (algorithm !== 'sha256') {
        return false;
    }

    const saltedPassword = salt + password;
    const hashBuffer = await crypto.subtle.digest('SHA-256', stringToArrayBuffer(saltedPassword));
    const computedHash = arrayBufferToHex(hashBuffer);

    return computedHash === hash;
}
