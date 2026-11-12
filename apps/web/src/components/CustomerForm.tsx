import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatPhone, type CustomerDTO } from '@bitebrew/shared';
import { ApiError, errorMessage, patch, post } from '../api/client';
import { Field, Modal, useToast } from './ui';

/** Add or edit a regular customer (name + phone). Used on the Customers page and at the till. */
export function CustomerForm({ initial, presetPhone, onClose, onSaved }: { initial: CustomerDTO | null; presetPhone?: string; onClose: () => void; onSaved?: (c: CustomerDTO) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState({ name: initial?.name ?? '', phone: initial?.phone ?? presetPhone ?? '', notes: initial?.notes ?? '', isActive: initial?.isActive ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => (await (initial ? patch<{ customer: CustomerDTO }>(`/customers/${initial.id}`, { ...d, version: initial.version }) : post<{ customer: CustomerDTO }>('/customers', { name: d.name, phone: d.phone, notes: d.notes }))).customer,
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ['customers'] }); toast('success', initial ? 'Customer updated' : `${c.name} saved`); onSaved?.(c); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); setError(errorMessage(e)); },
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New regular customer'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="cust-form" disabled={save.isPending || !d.name.trim() || !d.phone.trim()} data-testid="customer-save">{save.isPending ? 'Saving…' : 'Save'}</button></>}>
      <form id="cust-form" className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); setErrors({}); setError(null); save.mutate(); }}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <Field label="Name" htmlFor="cu-name" error={errors.name}><input id="cu-name" className="input" maxLength={80} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus data-testid="customer-name" /></Field>
        <Field label="Phone number" htmlFor="cu-phone" hint={d.phone ? `Saved as ${formatPhone(d.phone)}` : 'e.g. 01712-345678'} error={errors.phone}>
          <input id="cu-phone" className="input num" type="tel" inputMode="tel" maxLength={20} value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} data-testid="customer-phone" />
        </Field>
        <Field label="Notes (optional)" htmlFor="cu-notes"><input id="cu-notes" className="input" maxLength={300} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="e.g. likes extra spicy, allergic to nuts" /></Field>
        {initial && <label className="check"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active (can be chosen at the till)</label>}
      </form>
    </Modal>
  );
}
