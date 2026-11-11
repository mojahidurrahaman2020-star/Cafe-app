import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ADJUST_LABELS,
  BASE_UNIT,
  DIMENSION_LABELS,
  DIMENSIONS,
  fromBase,
  formatQty,
  INGREDIENT_ADJUST_TYPES,
  unitsFor,
  UNITS,
  type Dimension,
  type IngredientAdjustType,
  type IngredientDTO,
  type ProductDTO,
  type SupplierDTO,
  type UnitCode,
} from '@bitebrew/shared';
import { ApiError, errorMessage, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFormat } from '../lib/hooks';
import { requestId } from '../lib/ids';
import { STOCK_KEYS, useSuppliers } from '../lib/queries';
import { MoneyInput, QtyInput } from './inputs';
import { Field, Modal, useToast } from './ui';

export function useInvalidateStock() {
  const qc = useQueryClient();
  return () => STOCK_KEYS.forEach((k) => void qc.invalidateQueries({ queryKey: [...k] }));
}

function shortageText(err: unknown): string {
  if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
    const s = (err.details as { shortages?: { name: string; onHand: number }[] })?.shortages ?? [];
    return `${err.message}. ${s.map((x) => `${x.name}: only ${x.onHand} on hand`).join('; ')}`;
  }
  return errorMessage(err);
}

/** A stable request id for one open dialog: retries/double-taps reuse it. */
function useRequestId() {
  const [id] = useState(requestId);
  return id;
}

// ─────────── Receive ingredient delivery ───────────
export function ReceiveDialog({ ingredient, onClose }: { ingredient: IngredientDTO; onClose: () => void }) {
  const toast = useToast();
  const fmt = useFormat();
  const refresh = useInvalidateStock();
  const suppliers = useSuppliers();
  const rid = useRequestId();
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<UnitCode>(ingredient.displayUnit);
  const [cost, setCost] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState(ingredient.supplier?.id ?? '');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/ingredients/${ingredient.id}/receive`, { quantity: Number(qty), unit, totalCostMinor: cost ?? 0, supplierId: supplierId || null, reference, requestId: rid }),
    onSuccess: () => {
      refresh();
      toast('success', `Received ${qty} ${UNITS[unit].label} of ${ingredient.name}`);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const q = Number(qty);
  const perUnit = q > 0 && cost !== null ? Math.round(cost / q) : null;
  return (
    <Modal
      title={`Receive ${ingredient.name}`}
      onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="recv" disabled={m.isPending || !(q > 0) || cost === null} data-testid="receive-save">{m.isPending ? 'Saving…' : 'Record delivery'}</button></>}
    >
      <form id="recv" className="stack" style={{ gap: 16 }} onSubmit={(e: FormEvent) => { e.preventDefault(); setError(null); m.mutate(); }}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <p className="muted">On hand now: <b>{formatQty(ingredient.onHand, ingredient.displayUnit)}</b></p>
        <Field label="Quantity received" htmlFor="rv-qty"><QtyInput id="rv-qty" testId="receive-qty" dimension={ingredient.dimension} quantity={qty} unit={unit} onChange={(v, u) => { setQty(v); setUnit(u); }} /></Field>
        <Field label="Total paid for this delivery" htmlFor="rv-cost" hint={perUnit !== null ? `≈ ${fmt.money(perUnit)} per ${UNITS[unit].label}` : 'Used to value stock and calculate cost of goods sold'}>
          <MoneyInput id="rv-cost" testId="receive-cost" value={cost} onChange={setCost} symbol={fmt.currency.currencySymbol} />
        </Field>
        <div className="form-grid">
          <Field label="Supplier" htmlFor="rv-sup">
            <select id="rv-sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— none —</option>
              {(suppliers.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Invoice / note (optional)" htmlFor="rv-ref"><input id="rv-ref" className="input" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
      </form>
    </Modal>
  );
}

// ─────────── Waste / spoilage / correction / count (ingredients or portions) ───────────
export function AdjustDialog({
  target,
  onClose,
}: {
  target: { kind: 'ingredient'; item: IngredientDTO } | { kind: 'portions'; item: ProductDTO };
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const rid = useRequestId();
  const isIng = target.kind === 'ingredient';
  const [type, setType] = useState<IngredientAdjustType>('WASTE');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<UnitCode>(isIng ? target.item.displayUnit : 'pcs');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onHandText = isIng ? formatQty(target.item.onHand, target.item.displayUnit) : `${target.item.portionsOnHand} portion(s)`;
  const m = useMutation({
    mutationFn: () =>
      isIng
        ? post(`/ingredients/${target.item.id}/adjust`, { type, quantity: Number(qty), unit, reason: reason || undefined, requestId: rid })
        : post(`/products/${target.item.id}/stock/adjust`, { type, quantity: Math.trunc(Number(qty)), reason: reason || undefined, requestId: rid }),
    onSuccess: () => {
      refresh();
      toast('success', 'Stock updated');
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.fieldErrors().reason ? e.fieldErrors().reason! : shortageText(e)),
  });
  const label = type === 'COUNT' ? 'Counted on hand' : type === 'ADJUSTMENT' ? 'Change (+ adds, − removes)' : 'Amount lost';
  return (
    <Modal
      title={`Adjust stock — ${target.item.name}`}
      onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="adj" disabled={m.isPending || qty === '' || qty === '-'} data-testid="adjust-save">{m.isPending ? 'Saving…' : 'Save'}</button></>}
    >
      <form id="adj" className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
        {error && <div className="alert error" role="alert">{error}</div>}
        <p className="muted">On hand now: <b>{onHandText}</b></p>
        <div className="segmented" role="group" aria-label="Type">
          {INGREDIENT_ADJUST_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
              {t === 'ADJUSTMENT' ? 'Correction' : t === 'COUNT' ? 'Stock count' : t[0] + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <p className="small muted">{ADJUST_LABELS[type]}</p>
        <Field label={label} htmlFor="adj-qty">
          {isIng ? (
            <QtyInput id="adj-qty" testId="adjust-qty" dimension={target.item.dimension} quantity={qty} unit={unit} allowNegative={type === 'ADJUSTMENT'} onChange={(v, u) => { setQty(v); setUnit(u); }} />
          ) : (
            <input id="adj-qty" data-testid="adjust-qty" className="input num" inputMode="numeric" value={qty} onChange={(e) => /^-?\d*$/.test(e.target.value) && setQty(e.target.value)} />
          )}
        </Field>
        <Field label={type === 'ADJUSTMENT' ? 'Reason (required)' : 'Reason / note'} htmlFor="adj-reason">
          <input id="adj-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

// ─────────── Receive ready-made units (RESALE) ───────────
export function ReceivePortionsDialog({ product, onClose }: { product: ProductDTO; onClose: () => void }) {
  const toast = useToast();
  const fmt = useFormat();
  const refresh = useInvalidateStock();
  const suppliers = useSuppliers();
  const rid = useRequestId();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/products/${product.id}/stock/receive`, { quantity: Number(qty), totalCostMinor: cost ?? 0, supplierId: supplierId || null, requestId: rid }),
    onSuccess: () => { refresh(); toast('success', `Received ${qty} × ${product.name}`); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal title={`Receive ${product.name}`} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="rp" disabled={m.isPending || !(Number(qty) > 0) || cost === null}>{m.isPending ? 'Saving…' : 'Record delivery'}</button></>}>
      <form id="rp" className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
        {error && <div className="alert error">{error}</div>}
        <Field label="Units received" htmlFor="rp-q"><input id="rp-q" className="input num" inputMode="numeric" value={qty} onChange={(e) => /^\d*$/.test(e.target.value) && setQty(e.target.value)} /></Field>
        <Field label="Total paid" htmlFor="rp-c"><MoneyInput id="rp-c" value={cost} onChange={setCost} symbol={fmt.currency.currencySymbol} /></Field>
        <Field label="Supplier" htmlFor="rp-s">
          <select id="rp-s" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— none —</option>
            {(suppliers.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

// ─────────── Ingredient create / edit ───────────
export function IngredientForm({ initial, onClose }: { initial: IngredientDTO | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStock();
  const { can } = useAuth();
  const suppliers = useSuppliers(can('inventory.view'));
  const [name, setName] = useState(initial?.name ?? '');
  const [dimension, setDimension] = useState<Dimension>(initial?.dimension ?? 'MASS');
  const [displayUnit, setDisplayUnit] = useState<UnitCode>(initial?.displayUnit ?? 'kg');
  const [minLevel, setMinLevel] = useState(initial ? String(fromBase(initial.minLevel, initial.displayUnit)) : '');
  const [supplierId, setSupplierId] = useState(initial?.supplier?.id ?? '');
  const [isPackaging, setIsPackaging] = useState(initial?.isPackaging ?? false);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const body = { name, displayUnit, minLevel: Number(minLevel || 0), supplierId: supplierId || null, isPackaging, notes };
      return initial ? patch(`/ingredients/${initial.id}`, { ...body, isActive, version: initial.version }) : post('/ingredients', { ...body, dimension });
    },
    onSuccess: () => { refresh(); toast('success', initial ? 'Ingredient updated' : 'Ingredient added'); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); setError(errorMessage(e)); },
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New ingredient'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="ingf" disabled={m.isPending || !name.trim()} data-testid="ingredient-save">{m.isPending ? 'Saving…' : 'Save'}</button></>}>
      <form id="ingf" className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setErrors({}); setError(null); m.mutate(); }}>
        {error && <div className="alert error">{error}</div>}
        <Field label="Name" htmlFor="if-name" error={errors.name}><input id="if-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="form-grid">
          <Field label="Measured by" htmlFor="if-dim" hint={initial ? 'Cannot change once created' : undefined}>
            <select id="if-dim" className="input" value={dimension} disabled={!!initial} onChange={(e) => { const d = e.target.value as Dimension; setDimension(d); setDisplayUnit(unitsFor(d).at(-1) ?? BASE_UNIT[d]); }}>
              {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
            </select>
          </Field>
          <Field label="Show quantities in" htmlFor="if-unit" error={errors.displayUnit}>
            <select id="if-unit" className="input" value={displayUnit} onChange={(e) => setDisplayUnit(e.target.value as UnitCode)}>
              {unitsFor(dimension).map((u) => <option key={u} value={u}>{UNITS[u].name}</option>)}
            </select>
          </Field>
          <Field label={`Minimum level (${UNITS[displayUnit].label})`} htmlFor="if-min" hint="Warn when stock falls to this level">
            <input id="if-min" className="input num" inputMode="decimal" value={minLevel} onChange={(e) => /^\d*(\.\d{0,3})?$/.test(e.target.value) && setMinLevel(e.target.value)} />
          </Field>
        </div>
        <Field label="Usual supplier" htmlFor="if-sup">
          <select id="if-sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— none —</option>
            {(suppliers.data ?? []).map((s: SupplierDTO) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <label className="check"><input type="checkbox" checked={isPackaging} onChange={(e) => setIsPackaging(e.target.checked)} /> Packaging material (cups, boxes, bags)</label>
        {initial && <label className="check"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>}
        <Field label="Notes" htmlFor="if-notes"><input id="if-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

// ─────────── Supplier create / edit ───────────
export function SupplierForm({ initial, onClose }: { initial: SupplierDTO | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState({ name: initial?.name ?? '', phone: initial?.phone ?? '', address: initial?.address ?? '', notes: initial?.notes ?? '', isActive: initial?.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => (initial ? patch(`/suppliers/${initial.id}`, { ...s, version: initial.version }) : post('/suppliers', s)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['suppliers'] }); toast('success', 'Supplier saved'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New supplier'} onClose={onClose}
      footer={<><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" form="supf" disabled={m.isPending || !s.name.trim()}>Save</button></>}>
      <form id="supf" className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
        {error && <div className="alert error">{error}</div>}
        <Field label="Name" htmlFor="sf-n"><input id="sf-n" className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required /></Field>
        <div className="form-grid">
          <Field label="Phone" htmlFor="sf-p"><input id="sf-p" className="input" type="tel" value={s.phone} onChange={(e) => setS({ ...s, phone: e.target.value })} /></Field>
          <Field label="Address" htmlFor="sf-a"><input id="sf-a" className="input" value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} /></Field>
        </div>
        <Field label="Notes" htmlFor="sf-no"><input id="sf-no" className="input" value={s.notes} onChange={(e) => setS({ ...s, notes: e.target.value })} /></Field>
        {initial && <label className="check"><input type="checkbox" checked={s.isActive} onChange={(e) => setS({ ...s, isActive: e.target.checked })} /> Active</label>}
      </form>
    </Modal>
  );
}
