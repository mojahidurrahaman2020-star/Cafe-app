import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, ROLE_HOME, type SessionUser } from '@bitebrew/shared';
import { ApiError, errorMessage, get, post } from '../api/client';
import { Field } from '../components/ui';
import logoUrl from '../assets/logo.svg';

/** First-run page of a newly hosted website: creates the owner account. Disappears once an account exists. */
export function SetupPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['setup'], queryFn: () => get<{ needsSetup: boolean; tokenRequired: boolean }>('/setup/status') });
  const [d, setD] = useState({ setupToken: '', fullName: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setErrors({});
    if (d.password !== d.confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      const { user } = await post<{ user: SessionUser }>('/setup', { setupToken: d.setupToken, fullName: d.fullName, username: d.username, password: d.password });
      qc.setQueryData(['me'], user);
      window.location.assign(ROLE_HOME[user.role]);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <section className="login-hero">
        <img src={logoUrl} alt="Bite & Brew logo" />
        <h1>Bite &amp; Brew</h1><div className="rule" /><div className="tag">Welcome</div><div className="est">LET'S SET UP YOUR CAFÉ</div>
      </section>
      <section className="login-panel">
        <form className="card login-card" onSubmit={submit} data-testid="setup-form">
          <h2>Create the owner account</h2>
          <p className="muted small">This appears only once. You will use this account to add the menu, staff and settings.</p>
          {error && <div className="alert error" role="alert">{error}</div>}
          {status.data?.tokenRequired && (
            <Field label="Setup code" htmlFor="su-token" hint="From your hosting dashboard (the SETUP_TOKEN setting)"><input id="su-token" className="input" autoComplete="off" value={d.setupToken} onChange={(e) => setD({ ...d, setupToken: e.target.value })} required data-testid="setup-token" /></Field>
          )}
          <Field label="Your name" htmlFor="su-name" error={errors.fullName}><input id="su-name" className="input" value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} required /></Field>
          <Field label="Username" htmlFor="su-user" hint="Lowercase letters, numbers, . _ -" error={errors.username}><input id="su-user" className="input" autoCapitalize="none" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} required /></Field>
          <Field label="Password" htmlFor="su-pass" hint={`At least ${PASSWORD_MIN_LENGTH} characters`} error={errors.password}><input id="su-pass" className="input" type="password" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} required /></Field>
          <Field label="Confirm password" htmlFor="su-conf"><input id="su-conf" className="input" type="password" autoComplete="new-password" value={d.confirm} onChange={(e) => setD({ ...d, confirm: e.target.value })} required /></Field>
          <button className="btn gold" style={{ minHeight: 54 }} disabled={busy} data-testid="setup-submit">{busy ? 'Creating…' : 'Create account & start'}</button>
        </form>
      </section>
    </div>
  );
}
