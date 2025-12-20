import { createRoot } from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import { ImpersonateProvider } from './contexts/ImpersonateContext';
import { ToastProvider } from './components/Toast';
import { AppRouter } from './router';

// ===== 应用根组件 =====
const App = () => {
    return (
        <ToastProvider>
            <AuthProvider>
                <ImpersonateProvider>
                    <AppRouter />
                </ImpersonateProvider>
            </AuthProvider>
        </ToastProvider>
    );
};

// ===== 初始化应用 =====
const root = createRoot(document.getElementById('app'));
root.render(<App />);

