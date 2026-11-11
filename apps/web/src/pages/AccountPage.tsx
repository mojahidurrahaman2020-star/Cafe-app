import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@bitebrew/shared';
import { ApiError, errorMessage, post } from '../api/client';
import { Field, useToast } from '../components/ui';

export function AccountPage() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError('The new passwords do not match');
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast('success', 'Password changed. Other devices have been signed out.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError && err.fieldErrors().newPassword ? err.fieldErrors().newPassword! : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1>Change password</h1>
      <form className="card card-pad stack" style={{ gap: 16 }} onSubmit={submit}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <Field label="Current password" htmlFor="a-cur"><input id="a-cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="New password" htmlFor="a-new" hint={`At least ${PASSWORD_MIN_LENGTH} characters`}><input id="a-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} /></Field>
        <Field label="Confirm new password" htmlFor="a-conf"><input id="a-conf" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </div>
  );
}
