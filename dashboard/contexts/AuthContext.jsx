import { createContext, useContext, useState, useEffect } from 'react';

const FRONTEND_DEFAULT_URL = 'https://sub-store.vercel.app/';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [token, setToken] = useState(() => localStorage.getItem('ss_token'));
    const [role, setRole] = useState(() => localStorage.getItem('ss_role'));
    const [userPath, setUserPath] = useState(() => localStorage.getItem('ss_path'));
    const [frontendUrl, setFrontendUrl] = useState(() =>
        localStorage.getItem('ss_frontend_url') || FRONTEND_DEFAULT_URL
    );
    const [mustChangePassword, setMustChangePassword] = useState(() =>
        localStorage.getItem('ss_must_change_password') === '1'
    );
    const [validating, setValidating] = useState(!!localStorage.getItem('ss_token'));

    const isAuthenticated = !!token;
    const isAdmin = role === 'admin';

    // 验证 token 有效性（仅在明确 401 时清除）
    useEffect(() => {
        const validateToken = async () => {
            const storedToken = localStorage.getItem('ss_token');
            if (!storedToken) {
                setValidating(false);
                return;
            }

            try {
                const res = await fetch('/api/dashboard/user/me', {
                    headers: { 'Authorization': `Bearer ${storedToken}` }
                });

                // 只有明确的 401 才清除登录状态
                if (res.status === 401) {
                    console.log('[Auth] Token 无效，清除登录状态');
                    localStorage.removeItem('ss_token');
                    localStorage.removeItem('ss_role');
                    localStorage.removeItem('ss_path');
                    localStorage.removeItem('ss_frontend_url');
                    setToken(null);
                    setRole(null);
                    setUserPath(null);
                    setFrontendUrl(FRONTEND_DEFAULT_URL);
                } else if (res.ok) {
                    // 刷新 frontendUrl
                    try {
                        const settingsRes = await fetch('/api/dashboard/settings/public');
                        if (settingsRes.ok) {
                            const settings = await settingsRes.json();
                            if (settings.frontendUrl) {
                                localStorage.setItem('ss_frontend_url', settings.frontendUrl);
                                setFrontendUrl(settings.frontendUrl);
                            }
                        }
                    } catch (e) {
                        // 忽略刷新失败
                    }
                }
                // 其他错误（网络问题、超时等）不处理，保持当前状态
            } catch (e) {
                // 网络错误不清除登录状态
                console.log('[Auth] 验证请求失败，保持当前状态:', e.message);
            } finally {
                setValidating(false);
            }
        };

        validateToken();
    }, []);

    const login = (newToken, newRole, path, feUrl, mustChange = false) => {
        localStorage.setItem('ss_token', newToken);
        localStorage.setItem('ss_role', newRole);
        localStorage.setItem('ss_path', path || '');
        if (feUrl) {
            localStorage.setItem('ss_frontend_url', feUrl);
            setFrontendUrl(feUrl);
        }
        localStorage.setItem('ss_must_change_password', mustChange ? '1' : '0');
        setToken(newToken);
        setRole(newRole);
        setUserPath(path || '');
        setMustChangePassword(!!mustChange);
    };

    const logout = () => {
        localStorage.removeItem('ss_token');
        localStorage.removeItem('ss_role');
        localStorage.removeItem('ss_path');
        localStorage.removeItem('ss_frontend_url');
        localStorage.removeItem('ss_must_change_password');
        setToken(null);
        setRole(null);
        setUserPath(null);
        setFrontendUrl(FRONTEND_DEFAULT_URL);
        setMustChangePassword(false);
    };

    const updatePath = (newPath) => {
        localStorage.setItem('ss_path', newPath);
        setUserPath(newPath);
    };

    const value = {
        token,
        role,
        userPath,
        frontendUrl,
        isAuthenticated,
        isAdmin,
        mustChangePassword,
        validating,
        login,
        logout,
        updatePath,
        setMustChangePassword,
    };

    // 验证期间显示加载状态
    if (validating) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                <div className="text-white/60">验证中...</div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
