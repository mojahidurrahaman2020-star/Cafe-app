import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_HOME } from '@bitebrew/shared';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { EnvBanner, StatusPill } from '../layout/AppShell';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EnvBanner />
      <div className="login-wrap">
        <section className="login-hero">
          <img src="/icon.svg" alt="Bite & Brew logo" />
          <h1>Bite &amp; Brew</h1>
          <div className="rule" />
          <div className="tag">Café &amp; Hangout</div>
          <div className="est">EST. 2027</div>
        </section>
        <section className="login-panel">
          <form className="card login-card" onSubmit={submit} aria-labelledby="signin-title">
            <div className="row">
              <h2 id="signin-title">Staff sign in</h2>
              <span className="spacer" />
              <StatusPill />
            </div>
            {error && (
              <div className="alert error" role="alert" data-testid="login-error">
                {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn gold" type="submit" disabled={busy || !username || !password} style={{ minHeight: 54, fontSize: '1.05rem' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="muted small">Forgotten your password? Ask the owner or a manager to reset it.</p>
          </form>
        </section>
      </div>
    </>
  );
}
