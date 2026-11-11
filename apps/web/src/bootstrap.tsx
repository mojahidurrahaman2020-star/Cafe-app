import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/ui';
import { ConnectionProvider } from './realtime/ConnectionContext';
import './styles/global.css';
import './styles/shell.css';

/** Renders the app. The online demo uses an in-memory router (it runs inside a hosted page). */
export function bootstrap(opts: { memoryRouter?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false }, // never auto-retry writes (avoids duplicate submissions)
    },
  });
  const Router: ComponentType<{ children: ReactNode }> = opts.memoryRouter ? MemoryRouter : BrowserRouter;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <ConnectionProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </ConnectionProvider>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </StrictMode>,
  );
}
