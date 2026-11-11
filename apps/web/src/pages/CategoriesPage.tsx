import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MENU_GROUP_LABELS,
  MENU_GROUPS,
  PREP_STATION_LABELS,
  PREP_STATIONS,
  type MenuCategoryDTO,
  type MenuGroup,
  type PrepStation,
} from '@bitebrew/shared';
import { ApiError, del, errorMessage, get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { ConfirmDialog, Field, Loading, Modal, useToast } from '../components/ui';

const groupBadge: Record<MenuGroup, string> = { FOOD: 'food', DRINKS: 'drinks', DESSERTS: 'desserts' };
const defaultStation: Record<MenuGroup, PrepStation> = { FOOD: 'KITCHEN', DRINKS: 'BARISTA', DESSERTS: 'KITCHEN' };

type Draft = { name: string; group: MenuGroup; station: PrepStation; description: string; isActive: boolean };

function CategoryForm({
  initial,
  onClose,
}: {
  initial: MenuCategoryDTO | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(
    initial
      ? { name: initial.name, group: initial.group, station: initial.station, description: initial.description ?? '', isActive: initial.isActive }
      : { name: '', group: 'FOOD', station: 'KITCHEN', description: '', isActive: true },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      initial
        ? patch(`/categories/${initial.id}`, { ...draft, version: initial.version })
        : post('/categories', draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('success', initial ? `“${draft.name.trim()}” updated` : `“${draft.name.trim()}” created`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        if (err.code === 'STALE_VERSION') void qc.invalidateQueries({ queryKey: ['categories'] });
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
      title={initial ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn" form="category-form" type="submit" disabled={save.isPending || !draft.name.trim()} data-testid="category-save">
            {save.isPending ? 'Saving…' : 'Save category'}
          </button>
        </>
      }
    >
      <form id="category-form" className="stack" onSubmit={submit} style={{ gap: 16 }}>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <Field label="Name" htmlFor="cat-name" error={errors.name}>
          <input id="cat-name" className="input" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={!!errors.name} required />
        </Field>
        <div className="form-grid">
          <Field label="Menu group" htmlFor="cat-group" error={errors.group}>
            <select
              id="cat-group"
              className="input"
              value={draft.group}
              onChange={(e) => {
                const group = e.target.value as MenuGroup;
                // Suggest the matching station when creating; never override an existing choice silently.
                setDraft({ ...draft, group, station: initial ? draft.station : defaultStation[group] });
              }}
            >
              {MENU_GROUPS.map((g) => (
                <option key={g} value={g}>{MENU_GROUP_LABELS[g]}</option>
              ))}
            </select>
          </Field>
          <Field label="Preparation station" htmlFor="cat-station" hint="Decides which printer receives tickets" error={errors.station}>
            <select id="cat-station" className="input" value={draft.station} onChange={(e) => setDraft({ ...draft, station: e.target.value as PrepStation })}>
              {PREP_STATIONS.map((s) => (
                <option key={s} value={s}>{PREP_STATION_LABELS[s]}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description (optional)" htmlFor="cat-desc" error={errors.description}>
          <textarea id="cat-desc" className="input" maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          Visible on the menu / POS
        </label>
      </form>
    </Modal>
  );
}

export function CategoriesPage() {
  const { can } = useAuth();
  const canManage = can('menu.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<MenuCategoryDTO | null | 'new'>(null);
  const [deleting, setDeleting] = useState<MenuCategoryDTO | null>(null);
  const [filter, setFilter] = useState<MenuGroup | 'ALL'>('ALL');

  const list = useQuery({
    queryKey: ['categories', { includeInactive: true }],
    queryFn: async () => (await get<{ categories: MenuCategoryDTO[] }>('/categories?includeInactive=true')).categories,
  });

  const remove = useMutation({
    mutationFn: (c: MenuCategoryDTO) => del(`/categories/${c.id}?version=${c.version}`),
    onSuccess: (_d, c) => {
      toast('success', `“${c.name}” deleted`);
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      toast('error', errorMessage(err));
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (c: MenuCategoryDTO) => patch(`/categories/${c.id}`, { isActive: !c.isActive, version: c.version }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
    onError: (err) => {
      toast('error', errorMessage(err));
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const rows = (list.data ?? []).filter((c) => filter === 'ALL' || c.group === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Menu categories</h1>
          <p>Organise the menu. Each category's station decides whether its tickets go to the kitchen or the barista printer.</p>
        </div>
        {canManage && (
          <button className="btn gold" onClick={() => setEditing('new')} data-testid="category-new">
            <Icon.plus width={20} /> New category
          </button>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Filter by group">
        {(['ALL', ...MENU_GROUPS] as const).map((g) => (
          <button key={g} aria-pressed={filter === g} onClick={() => setFilter(g)}>
            {g === 'ALL' ? 'All' : MENU_GROUP_LABELS[g]}
          </button>
        ))}
      </div>

      <div className="card">
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <div className="alert error" style={{ margin: 16 }}>{errorMessage(list.error)}</div>
        ) : rows.length === 0 ? (
          <div className="empty">No categories{filter !== 'ALL' ? ' in this group' : ''} yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="category-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Group</th>
                  <th>Station / printer</th>
                  <th>Status</th>
                  {canManage && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={c.isActive ? '' : 'inactive'} data-testid="category-row">
                    <td>
                      <b>{c.name}</b>
                      {c.description && <div className="muted small">{c.description}</div>}
                    </td>
                    <td><span className={`badge ${groupBadge[c.group]}`}>{MENU_GROUP_LABELS[c.group]}</span></td>
                    <td>{c.station === 'KITCHEN' ? 'Kitchen' : 'Barista'}</td>
                    <td>
                      {canManage ? (
                        <button className={`badge ${c.isActive ? 'ok' : 'neutral'}`} style={{ border: 0, cursor: 'pointer', minHeight: 32 }} onClick={() => toggle.mutate(c)} title="Tap to toggle visibility">
                          {c.isActive ? 'Visible' : 'Hidden'}
                        </button>
                      ) : (
                        <span className={`badge ${c.isActive ? 'ok' : 'neutral'}`}>{c.isActive ? 'Visible' : 'Hidden'}</span>
                      )}
                    </td>
                    {canManage && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn ghost icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)} data-testid="category-edit">
                          <Icon.edit width={20} />
                        </button>
                        <button className="btn ghost icon" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)} data-testid="category-delete">
                          <Icon.trash width={20} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <CategoryForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete category?"
          danger
          confirmLabel="Delete"
          busy={remove.isPending}
          message={
            <p>
              Delete <b>{deleting.name}</b> permanently? If you might use it again, hide it instead. (Once products exist, categories in use
              can only be hidden.)
            </p>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
        />
      )}
    </div>
  );
}
