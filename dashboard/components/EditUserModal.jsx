import { useState } from 'react';
import { useToast } from './Toast';

const EditUserModal = ({ user, token, baseUrl, onClose, onSuccess, onRefresh }) => {
    const [username, setUsername] = useState(user.username);
    const [saving, setSaving] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [currentPath, setCurrentPath] = useState(user.path);
    const [notes, setNotes] = useState(user.notes || '');
    const [savingNotes, setSavingNotes] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [resettingPassword, setResettingPassword] = useState(false);
    const toast = useToast();

    const handleSave = async () => {
        if (username !== user.username) {
            setSaving(true);
            try {
                const res = await fetch(`/api/dashboard/admin/user/${user.id}/username`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ newUsername: username })
                });
                if (!res.ok) {
                    const data = await res.json();
                    toast.error(data.error || '保存失败');
                    setSaving(false);
                    return;
                }
            } catch (e) {
                toast.error('保存失败');
                setSaving(false);
                return;
            }
        }
        toast.success('保存成功！');
        onSuccess();
    };

    const handleRegeneratePath = async () => {
        if (!confirm('确定要为此用户重新生成访问路径吗？')) return;

        setRegenerating(true);
        try {
            // 调用后端生成新路径
            const res = await fetch(`/api/dashboard/admin/user/${user.id}/regenerate-path`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setCurrentPath(data.path);
                toast.success('路径已重新生成！');
            } else {
                toast.error('重新生成失败');
            }
        } catch (e) {
            toast.error('重新生成失败');
        } finally {
            setRegenerating(false);
        }
    };

    const handleSavePath = async () => {
        if (!confirm('确定要保存新路径吗？旧路径将失效。')) return;
        try {
            const res = await fetch(`/api/dashboard/admin/user/${user.id}/path`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ newPath: currentPath })
            });
            if (res.ok) {
                toast.success('路径已保存！');
            } else {
                toast.error('保存失败');
            }
        } catch (e) {
            toast.error('保存失败');
        }
    };

    const handleSaveNotes = async () => {
        setSavingNotes(true);
        try {
            const res = await fetch(`/api/dashboard/admin/user/${user.id}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ notes })
            });
            if (res.ok) {
                toast.success('备注已保存！');
                onRefresh?.();
            } else {
                toast.error('保存失败');
            }
        } catch (e) {
            toast.error('保存失败');
        } finally {
            setSavingNotes(false);
        }
    };

    const handleResetPassword = async () => {
        if (!newPassword) return;
        setResettingPassword(true);
        try {
            const res = await fetch(`/api/dashboard/admin/user/${user.id}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ newPassword })
            });
            if (res.ok) {
                toast.success('密码已重置！');
                setNewPassword('');
            } else {
                toast.error('重置失败');
            }
        } catch (e) {
            toast.error('重置失败');
        } finally {
            setResettingPassword(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-lg">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-semibold text-white">编辑用户</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">用户名</label>
                        <input
                            className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">访问路径</label>
                        <div className="flex gap-2">
                            <input
                                className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-cyan-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                value={currentPath}
                                onChange={e => setCurrentPath(e.target.value)}
                                placeholder="自定义路径"
                            />
                            <button
                                onClick={handleSavePath}
                                className="w-16 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors text-sm"
                            >
                                保存
                            </button>
                        </div>
                        <button
                            onClick={handleRegeneratePath}
                            disabled={regenerating}
                            className="w-full mt-2 py-3 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                        >
                            <svg className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {regenerating ? '生成中...' : '随机生成新路径'}
                        </button>
                    </div>

                    {/* 备注 (仅管理员可见) */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            备注 <span className="text-gray-600">(仅管理员可见)</span>
                        </label>
                        <div className="flex gap-2">
                            <input
                                className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-cyan-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="输入备注信息..."
                            />
                            <button
                                onClick={handleSaveNotes}
                                disabled={savingNotes}
                                className="w-16 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-colors text-sm disabled:opacity-50"
                            >
                                {savingNotes ? '...' : '保存'}
                            </button>
                        </div>
                    </div>

                    {/* 重置密码 */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">重置密码</label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                placeholder="输入新密码"
                            />
                            <button
                                onClick={handleResetPassword}
                                disabled={resettingPassword || !newPassword}
                                className="w-16 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl transition-colors text-sm disabled:opacity-50"
                            >
                                {resettingPassword ? '...' : '重置'}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-2">完整 API 地址</label>
                        <div className="flex gap-2">
                            <code className="flex-1 px-4 py-3 bg-slate-700/30 border border-slate-600 rounded-xl text-gray-400 text-sm break-all">
                                {baseUrl}/{currentPath}
                            </code>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(`${baseUrl}/${currentPath}`);
                                    toast.success('已复制到剪贴板');
                                }}
                                className="w-16 py-3 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-xl transition-colors flex items-center justify-center"
                                title="复制"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-slate-700 text-gray-300 rounded-xl hover:bg-slate-600 transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditUserModal;
