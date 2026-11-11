import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageRole, hasPermission, PASSWORD_MIN_LENGTH, PERMISSIONS, ROLE_LABELS, ROLES, type Role, type UserDTO } from '@bitebrew/shared';
import { ApiError, errorMessage, get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';

function UserForm({ initial, onClose }: { initial: UserDTO | null; onClose: () => void }) {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const assignable = ROLES.filter((r) => canManageRole(me!.role, r));
  const [username, setUsername] = useState(initial?.username ?? '');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [role, setRole] = useState<Role>(initial?.role ?? assignable[assignable.length - 1] ?? 'CASHIER');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isSelf = initial?.id === me?.id;

  const save = useMutation({
    mutationFn: () =>
      initial
        ? patch(`/users/${initial.id}`, {
            fullName,
            ...(isSelf ? {} : { role, isActive }),
            ...(password ? { password } : {}),
            version: initial.version,
          })
        : post('/users', { username, fullName, role, password }),
    onSuccess: () => {
      toast('success', initial ? 'Account updated' : 'Account created');
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        if (err.code === 'STALE_VERSION') void qc.invalidateQueries({ queryKey: ['users'] });
      }
      setFormError(errorMessage(err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    save.mutate();
  };

  return (
    <Modal
      title={initial ? `Edit ${initial.fullName}` : 'New staff account'}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit" form="user-form" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="user-form" className="stack" style={{ gap: 16 }} onSubmit={submit}>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Username" htmlFor="u-name" hint="Used to sign in. Lowercase letters, numbers, . _ -" error={errors.username}>
          <input id="u-name" className="input" value={username} disabled={!!initial} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Full name" htmlFor="u-full" error={errors.fullName}>
          <input id="u-full" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Role" htmlFor="u-role" error={errors.role}>
          <select id="u-role" className="input" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
            {(initial && !assignable.includes(initial.role) ? [initial.role, ...assignable] : assignable).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        <Field
          label={initial ? 'Reset password (leave blank to keep)' : 'Initial password'}
          htmlFor="u-pass"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Resetting signs this person out of all devices.`}
          error={errors.password}
        >
          <input id="u-pass" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!initial} minLength={PASSWORD_MIN_LENGTH} />
        </Field>
        {initial && !isSelf && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Account active (can sign in)
          </label>
        )}
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { can, user: me } = useAuth();
  const fmt = useFormat();
  const [editing, setEditing] = useState<UserDTO | 'new' | null>(null);
  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await get<{ users: UserDTO[] }>('/users')).users,
  });
  const canManage = can('users.manage');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Staff &amp; roles</h1>
          <p>Each person signs in with their own account so every sale and change is traceable.</p>
        </div>
        {canManage && (
          <button className="btn gold" onClick={() => setEditing('new')} data-testid="user-new">
            <Icon.plus width={20} /> New staff account
          </button>
        )}
      </div>
      <div className="card">
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <div className="alert error" style={{ margin: 16 }}>{errorMessage(users.error)}</div>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="users-table">
              <thead>
                <tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th>{canManage && <th />}</tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                    <td><b>{u.fullName}</b>{u.id === me?.id && <span className="badge gold" style={{ marginLeft: 8 }}>You</span>}</td>
                    <td className="muted">{u.username}</td>
                    <td><span className="badge neutral">{ROLE_LABELS[u.role]}</span></td>
                    <td><span className={`badge ${u.isActive ? 'ok' : 'bad'}`}>{u.isActive ? 'Active' : 'Deactivated'}</span></td>
                    <td className="muted small">{u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : 'Never'}</td>
                    {canManage && (
                      <td style={{ textAlign: 'right' }}>
                        {(u.id === me?.id || canManageRole(me!.role, u.role)) && (
                          <button className="btn ghost icon" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}>
                            <Icon.edit width={20} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <RoleMatrix />
      {editing && <UserForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}


function RoleMatrix() {
  return (
    <details className="card">
      <summary className="card-header" style={{ cursor: 'pointer', minHeight: 56 }}><h3>Permission matrix</h3></summary>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Permission</th>{ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}</tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td className="small"><code>{p}</code></td>
                {ROLES.map((r) => (
                  <td key={r} style={{ textAlign: 'center' }} aria-label={hasPermission(r, p) ? 'allowed' : 'not allowed'}>
                    {hasPermission(r, p) ? '✔' : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
