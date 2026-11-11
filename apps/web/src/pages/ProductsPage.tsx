import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fromBase,
  MENU_GROUP_LABELS,
  MENU_GROUPS,
  PREP_STATION_LABELS,
  PREP_STATIONS,
  STOCK_MODE_LABELS,
  STOCK_MODE_SHORT,
  STOCK_MODES,
  UNITS,
  type IngredientDTO,
  type MenuGroup,
  type PrepStation,
  type ProductDTO,
  type StockMode,
  type UnitCode,
} from '@bitebrew/shared';
import { ApiError, del, errorMessage, patch, post, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { MoneyInput, QtyInput, Tabs } from '../components/inputs';
import { AdjustDialog, ReceivePortionsDialog } from '../components/stockDialogs';
import { ConfirmDialog, Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useCategories, useIngredients, useProducts } from '../lib/queries';
import { StockHistory } from './InventoryPage';

export function AvailabilityPill({ p }: { p: Pick<ProductDTO, 'available' | 'isAvailable' | 'soldOut'> }) {
  if (!p.isAvailable) return <span className="qty-pill na">Off</span>;
  if (p.available === null) return <span className="qty-pill na">Not tracked</span>;
  if (p.available <= 0) return <span className="qty-pill out">Sold out</span>;
  return <span className={`qty-pill ${p.available <= 5 ? 'low' : 'good'}`}>{p.available}</span>;
}

function useRefreshProducts() {
  const qc = useQueryClient();
  return () => ['products', 'availability', 'dashboard', 'categories'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
}

// ───────────── Details ─────────────
function DetailsForm({ product, onSaved, onClose }: { product: ProductDTO | null; onSaved: (p: ProductDTO) => void; onClose: () => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const refresh = useRefreshProducts();
  const { can } = useAuth();
  const categories = useCategories(true);
  const [d, setD] = useState({
    categoryId: product?.categoryId ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    priceMinor: product?.priceMinor ?? null as number | null,
    stockMode: product?.stockMode ?? ('MADE_TO_ORDER' as StockMode),
    stationOverride: product?.stationOverride ?? (null as PrepStation | null),
    isAvailable: product?.isAvailable ?? true,
    isActive: product?.isActive ?? true,
    manualCostMinor: product?.manualCostMinor ?? (null as number | null),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const body = { ...d, priceMinor: d.priceMinor ?? -1 };
      const r = product
        ? await patch<{ product: ProductDTO }>(`/products/${product.id}`, { ...body, version: product.version })
        : await post<{ product: ProductDTO }>('/products', body);
      return r.product;
    },
    onSuccess: (p) => { refresh(); toast('success', product ? 'Menu item saved' : `“${p.name}” added`); onSaved(p); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); setError(errorMessage(e)); },
  });
  const cat = categories.data?.find((c) => c.id === d.categoryId);
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setErrors({}); setError(null); m.mutate(); }} id="product-details">
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="form-grid">
        <Field label="Name" htmlFor="pd-name" error={errors.name}><input id="pd-name" className="input" maxLength={100} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required /></Field>
        <Field label="Category" htmlFor="pd-cat" error={errors.categoryId}>
          <select id="pd-cat" className="input" value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })} required>
            <option value="" disabled>Choose…</option>
            {MENU_GROUPS.map((g) => (
              <optgroup key={g} label={MENU_GROUP_LABELS[g]}>
                {(categories.data ?? []).filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (hidden)'}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Selling price" htmlFor="pd-price" error={errors.priceMinor && 'Enter a valid price'}>
          <MoneyInput id="pd-price" testId="product-price" value={d.priceMinor} onChange={(v) => setD({ ...d, priceMinor: v })} symbol={fmt.currency.currencySymbol} invalid={!!errors.priceMinor} />
        </Field>
      </div>
      <Field label="How is its stock tracked?" htmlFor="pd-mode" error={errors.stockMode}>
        <select id="pd-mode" className="input" value={d.stockMode} onChange={(e) => setD({ ...d, stockMode: e.target.value as StockMode })} data-testid="product-mode">
          {STOCK_MODES.map((s) => <option key={s} value={s}>{STOCK_MODE_LABELS[s]}</option>)}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Preparation station / printer" htmlFor="pd-station" hint={cat ? `Category default: ${cat.station === 'KITCHEN' ? 'Kitchen' : 'Barista'}` : undefined}>
          <select id="pd-station" className="input" value={d.stationOverride ?? ''} onChange={(e) => setD({ ...d, stationOverride: (e.target.value || null) as PrepStation | null })}>
            <option value="">Same as category</option>
            {PREP_STATIONS.map((s) => <option key={s} value={s}>{PREP_STATION_LABELS[s]}</option>)}
          </select>
        </Field>
        {d.stockMode === 'UNTRACKED' && can('reports.view') && (
          <Field label="Estimated cost per portion" htmlFor="pd-cost" hint="Used for profit estimates">
            <MoneyInput id="pd-cost" value={d.manualCostMinor} onChange={(v) => setD({ ...d, manualCostMinor: v })} symbol={fmt.currency.currencySymbol} />
          </Field>
        )}
      </div>
      <Field label="Description (optional)" htmlFor="pd-desc"><input id="pd-desc" className="input" maxLength={300} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      <div className="form-grid">
        <label className="check"><input type="checkbox" checked={d.isAvailable} onChange={(e) => setD({ ...d, isAvailable: e.target.checked })} /> Available to order today</label>
        <label className="check"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active on the menu</label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        <button className="btn" disabled={m.isPending || !d.name.trim() || !d.categoryId || d.priceMinor === null} data-testid="product-save">{m.isPending ? 'Saving…' : product ? 'Save details' : 'Create item'}</button>
      </div>
    </form>
  );
}

// ───────────── Recipe ─────────────
type LineDraft = { ingredientId: string; quantity: string; unit: UnitCode; wastagePct: string };

function RecipeEditor({ product, onSaved }: { product: ProductDTO; onSaved: (p: ProductDTO) => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const refresh = useRefreshProducts();
  const { can } = useAuth();
  const ingredients = useIngredients(false);
  const byId = useMemo(() => new Map((ingredients.data ?? []).map((i) => [i.id, i])), [ingredients.data]);
  const [yieldN, setYieldN] = useState(String(product.recipeYield));
  const [lines, setLines] = useState<LineDraft[]>(
    product.recipe.map((l) => ({ ingredientId: l.ingredientId, quantity: String(fromBase(l.quantity, l.displayUnit)), unit: l.displayUnit, wastagePct: String(l.wastagePct) })),
  );
  const [error, setError] = useState<string | null>(null);
  const isBatch = product.stockMode === 'BATCH';
  const m = useMutation({
    mutationFn: async () =>
      (await api<{ product: ProductDTO }>('PUT', `/products/${product.id}/recipe`, {
        recipeYield: isBatch ? Number(yieldN) : 1,
        version: product.version,
        lines: lines.filter((l) => l.ingredientId).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit, wastagePct: Number(l.wastagePct || 0) })),
      })).product,
    onSuccess: (p) => { refresh(); toast('success', 'Recipe saved'); onSaved(p); },
    onError: (e) => setError(errorMessage(e)),
  });
  if (product.stockMode !== 'BATCH' && product.stockMode !== 'MADE_TO_ORDER') {
    return <div className="alert info">Recipes are used for batch-cooked and made-to-order items. Change the stock type on the Details tab to add one.</div>;
  }
  const showCost = can('reports.view');
  const lineCost = (l: LineDraft) => {
    const ing = byId.get(l.ingredientId);
    const q = Number(l.quantity);
    if (!ing || !(q > 0)) return 0;
    return Math.round(q * UNITS[l.unit].factor * (1 + Number(l.wastagePct || 0) / 100) * ing.avgCostMinor);
  };
  const total = lines.reduce((s, l) => s + lineCost(l), 0);
  const perPortion = Math.round(total / Math.max(1, isBatch ? Number(yieldN) || 1 : 1));
  const margin = product.priceMinor > 0 ? Math.round(((product.priceMinor - perPortion) / product.priceMinor) * 100) : 0;
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <p className="muted small">
        {isBatch
          ? 'Ingredients for one batch. When staff record a batch of N portions, these amounts are scaled and deducted once; selling portions later does not deduct ingredients again.'
          : 'Ingredients for ONE portion. They are deducted each time it is sold.'}
      </p>
      {isBatch && (
        <Field label="This recipe makes (portions)" htmlFor="rc-yield">
          <input id="rc-yield" className="input num" style={{ maxWidth: 200 }} inputMode="numeric" value={yieldN} onChange={(e) => /^\d*$/.test(e.target.value) && setYieldN(e.target.value)} data-testid="recipe-yield" />
        </Field>
      )}
      <div className="line-grid head"><span>Ingredient</span><span>Quantity</span><span>Wastage %</span><span className="text-right">{showCost ? 'Cost' : ''}</span><span /></div>
      {lines.map((l, idx) => {
        const ing = byId.get(l.ingredientId);
        return (
          <div className="line-grid" key={idx} data-testid="recipe-line">
            <select className="input" aria-label="Ingredient" value={l.ingredientId} onChange={(e) => {
              const i = byId.get(e.target.value);
              setLines(lines.map((x, j) => (j === idx ? { ...x, ingredientId: e.target.value, unit: i?.displayUnit ?? x.unit } : x)));
            }}>
              <option value="">Choose…</option>
              {(ingredients.data ?? []).map((i) => <option key={i.id} value={i.id} disabled={i.id !== l.ingredientId && lines.some((x) => x.ingredientId === i.id)}>{i.name}</option>)}
            </select>
            {ing ? (
              <QtyInput id={`rc-q-${idx}`} dimension={ing.dimension} quantity={l.quantity} unit={l.unit} onChange={(q, u) => setLines(lines.map((x, j) => (j === idx ? { ...x, quantity: q, unit: u } : x)))} />
            ) : <span className="muted small">Choose an ingredient</span>}
            <input className="input num" aria-label="Wastage percent" inputMode="decimal" value={l.wastagePct} onChange={(e) => /^\d{0,2}(\.\d{0,2})?$/.test(e.target.value) && setLines(lines.map((x, j) => (j === idx ? { ...x, wastagePct: e.target.value } : x)))} />
            <span className="num text-right small">{showCost ? fmt.money(lineCost(l)) : ''}</span>
            <button type="button" className="btn ghost icon" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== idx))}><Icon.trash width={18} /></button>
          </div>
        );
      })}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary sm" onClick={() => setLines([...lines, { ingredientId: '', quantity: '', unit: 'g', wastagePct: '0' }])} data-testid="recipe-add-line"><Icon.plus width={18} /> Add ingredient</button>
        {!ingredients.data?.length && <span className="small muted">Add ingredients on the Inventory screen first.</span>}
        <span className="spacer" />
        {showCost && <span className="muted">Cost per portion: <b className="num">{fmt.money(perPortion)}</b> · margin <b>{margin}%</b></span>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" disabled={m.isPending || lines.some((l) => l.ingredientId && !(Number(l.quantity) > 0)) || (isBatch && !(Number(yieldN) >= 1))} data-testid="recipe-save">{m.isPending ? 'Saving…' : 'Save recipe'}</button>
      </div>
    </form>
  );
}

// ───────────── Customisation options ─────────────
type OptDraft = { name: string; priceDeltaMinor: number | null; ingredientId: string; quantity: string; unit: UnitCode; isAvailable: boolean };
type GroupDraft = { name: string; minSelect: string; maxSelect: string; options: OptDraft[] };

function OptionsEditor({ product, onSaved }: { product: ProductDTO; onSaved: (p: ProductDTO) => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const refresh = useRefreshProducts();
  const { can } = useAuth();
  const ingredients = useIngredients(false, can('inventory.view'));
  const byId = new Map((ingredients.data ?? []).map((i: IngredientDTO) => [i.id, i]));
  const [groups, setGroups] = useState<GroupDraft[]>(
    product.modifierGroups.map((g) => ({
      name: g.name, minSelect: String(g.minSelect), maxSelect: String(g.maxSelect),
      options: g.options.map((o) => ({ name: o.name, priceDeltaMinor: o.priceDeltaMinor, ingredientId: o.ingredientId ?? '', quantity: o.quantity !== null && o.displayUnit ? String(fromBase(o.quantity, o.displayUnit)) : '', unit: o.displayUnit ?? 'g', isAvailable: o.isAvailable })),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const setG = (i: number, g: Partial<GroupDraft>) => setGroups(groups.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const setO = (gi: number, oi: number, o: Partial<OptDraft>) => setG(gi, { options: groups[gi]!.options.map((x, j) => (j === oi ? { ...x, ...o } : x)) });
  const m = useMutation({
    mutationFn: async () =>
      (await api<{ product: ProductDTO }>('PUT', `/products/${product.id}/modifiers`, {
        version: product.version,
        groups: groups.map((g) => ({
          name: g.name, minSelect: Number(g.minSelect || 0), maxSelect: Number(g.maxSelect || 1),
          options: g.options.map((o) => ({ name: o.name, priceDeltaMinor: o.priceDeltaMinor ?? 0, ingredientId: o.ingredientId || null, quantity: o.ingredientId ? Number(o.quantity) : null, unit: o.ingredientId ? o.unit : null, isAvailable: o.isAvailable })),
        })),
      })).product,
    onSuccess: (p) => { refresh(); toast('success', 'Options saved'); onSaved(p); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
      {error && <div className="alert error" role="alert">{error}</div>}
      <p className="muted small">Choices the cashier can pick, e.g. “Milk: Regular / Oat (+৳40)”, “Spice level”, “Extras”. Options can use extra stock (made-to-order items).</p>
      {groups.map((g, gi) => (
        <div key={gi} className="card card-pad stack" style={{ gap: 12, background: 'var(--cream-100)' }}>
          <div className="form-grid">
            <Field label="Option group" htmlFor={`og-n-${gi}`}><input id={`og-n-${gi}`} className="input" value={g.name} maxLength={60} onChange={(e) => setG(gi, { name: e.target.value })} placeholder="e.g. Milk" /></Field>
            <Field label="Must choose at least" htmlFor={`og-min-${gi}`}><input id={`og-min-${gi}`} className="input num" inputMode="numeric" value={g.minSelect} onChange={(e) => /^\d*$/.test(e.target.value) && setG(gi, { minSelect: e.target.value })} /></Field>
            <Field label="Can choose at most" htmlFor={`og-max-${gi}`}><input id={`og-max-${gi}`} className="input num" inputMode="numeric" value={g.maxSelect} onChange={(e) => /^\d*$/.test(e.target.value) && setG(gi, { maxSelect: e.target.value })} /></Field>
          </div>
          {g.options.map((o, oi) => {
            const ing = byId.get(o.ingredientId);
            return (
              <div key={oi} className="option-row">
                <input className="input" aria-label="Option name" value={o.name} maxLength={60} onChange={(e) => setO(gi, oi, { name: e.target.value })} placeholder="Option" />
                <MoneyInput id={`op-p-${gi}-${oi}`} value={o.priceDeltaMinor} allowNegative onChange={(v) => setO(gi, oi, { priceDeltaMinor: v })} symbol={`+${fmt.currency.currencySymbol}`} />
                <select className="input" aria-label="Uses ingredient" value={o.ingredientId} onChange={(e) => setO(gi, oi, { ingredientId: e.target.value, unit: byId.get(e.target.value)?.displayUnit ?? o.unit })}>
                  <option value="">No extra stock</option>
                  {(ingredients.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                {ing ? <QtyInput id={`op-q-${gi}-${oi}`} dimension={ing.dimension} quantity={o.quantity} unit={o.unit} onChange={(q, u) => setO(gi, oi, { quantity: q, unit: u })} /> : <span />}
                <button type="button" className="btn ghost icon" aria-label="Remove option" onClick={() => setG(gi, { options: g.options.filter((_, j) => j !== oi) })}><Icon.trash width={18} /></button>
              </div>
            );
          })}
          <div className="row">
            <button type="button" className="btn sm secondary" onClick={() => setG(gi, { options: [...g.options, { name: '', priceDeltaMinor: 0, ingredientId: '', quantity: '', unit: 'g', isAvailable: true }] })}><Icon.plus width={18} /> Add option</button>
            <span className="spacer" />
            <button type="button" className="btn sm ghost" onClick={() => setGroups(groups.filter((_, j) => j !== gi))}>Remove group</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn secondary" onClick={() => setGroups([...groups, { name: '', minSelect: '0', maxSelect: '1', options: [{ name: '', priceDeltaMinor: 0, ingredientId: '', quantity: '', unit: 'g', isAvailable: true }] }])} data-testid="options-add-group"><Icon.plus width={18} /> Add option group</button>
        <span className="spacer" />
        <button className="btn" disabled={m.isPending || groups.some((g) => !g.name.trim() || !g.options.length || g.options.some((o) => !o.name.trim() || o.priceDeltaMinor === null))}>{m.isPending ? 'Saving…' : 'Save options'}</button>
      </div>
    </form>
  );
}

// ───────────── Photo ─────────────
async function resizeImage(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoEditor({ product, onSaved }: { product: ProductDTO; onSaved: (p: ProductDTO) => void }) {
  const toast = useToast();
  const refresh = useRefreshProducts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const dataUrl = await resizeImage(file);
      const r = await api<{ product: ProductDTO }>('PUT', `/products/${product.id}/image`, { dataUrl });
      refresh(); onSaved(r.product); toast('success', 'Photo updated');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && <div className="alert error">{error}</div>}
      {product.hasImage ? (
        <img src={`/api/products/${product.id}/image?v=${product.imageVersion}`} alt={product.name} style={{ maxWidth: 320, width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
      ) : <div className="empty">No photo. Photos are optional and are resized automatically.</div>}
      <div className="row">
        <label className="btn secondary" style={{ cursor: 'pointer' }}>
          {busy ? 'Uploading…' : product.hasImage ? 'Replace photo' : 'Add photo'}
          <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </label>
        {product.hasImage && <button className="btn ghost" disabled={busy} onClick={async () => { const r = await del<{ product: ProductDTO }>(`/products/${product.id}/image`); refresh(); onSaved(r.product); }}>Remove</button>}
      </div>
    </div>
  );
}

// ───────────── Stock tab ─────────────
function StockTab({ product }: { product: ProductDTO }) {
  const { can } = useAuth();
  const [dialog, setDialog] = useState<'adjust' | 'receive' | null>(null);
  if (product.stockMode === 'UNTRACKED') return <div className="alert info">This item is not stock-controlled.</div>;
  if (product.stockMode === 'MADE_TO_ORDER') {
    return (
      <div className="stack">
        <p>Made to order: <b>{product.available ?? '—'}</b> can be made from current stock{product.limitingIngredient ? <> (limited by <b>{product.limitingIngredient}</b>)</> : null}.</p>
        <p className="muted small">Stock for this item lives in its ingredients — see the Inventory screen.</p>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span>Portions on hand: <AvailabilityPill p={product} /></span>
        <span className="spacer" />
        {product.stockMode === 'RESALE' && can('purchases.manage') && <button className="btn secondary" onClick={() => setDialog('receive')}>Receive units</button>}
        {can('inventory.adjust') && <button className="btn secondary" onClick={() => setDialog('adjust')}>Waste / count / correct</button>}
      </div>
      {product.stockMode === 'BATCH' && <p className="muted small">Portions are added by recording a batch on the Production screen.</p>}
      <StockHistory kind="FINISHED" itemId={product.id} limit={20} />
      {dialog === 'adjust' && <AdjustDialog target={{ kind: 'portions', item: product }} onClose={() => setDialog(null)} />}
      {dialog === 'receive' && <ReceivePortionsDialog product={product} onClose={() => setDialog(null)} />}
    </div>
  );
}

type EditorTab = 'details' | 'recipe' | 'options' | 'photo' | 'stock';

function ProductEditor({ initial, onClose }: { initial: ProductDTO | null; onClose: () => void }) {
  const [product, setProduct] = useState<ProductDTO | null>(initial);
  const [tab, setTab] = useState<EditorTab>('details');
  const products = useProducts(true);
  // keep in sync with live updates (e.g. a batch recorded on another device)
  const live = product ? products.data?.find((p) => p.id === product.id) : undefined;
  const current = live && live.version >= (product?.version ?? 0) ? live : product;
  return (
    <Modal title={current ? current.name : 'New menu item'} onClose={onClose} wide>
      {current && (
        <Tabs<EditorTab> value={tab} onChange={setTab} tabs={[
          { id: 'details', label: 'Details' },
          { id: 'recipe', label: 'Recipe', hidden: current.stockMode !== 'BATCH' && current.stockMode !== 'MADE_TO_ORDER' },
          { id: 'options', label: 'Options' },
          { id: 'photo', label: 'Photo' },
          { id: 'stock', label: 'Stock' },
        ]} />
      )}
      {tab === 'details' && <DetailsForm key={current?.version ?? 'new'} product={current} onClose={onClose} onSaved={(p) => { setProduct(p); if (!current && (p.stockMode === 'BATCH' || p.stockMode === 'MADE_TO_ORDER')) setTab('recipe'); }} />}
      {tab === 'recipe' && current && <RecipeEditor key={current.version} product={current} onSaved={setProduct} />}
      {tab === 'options' && current && <OptionsEditor key={current.version} product={current} onSaved={setProduct} />}
      {tab === 'photo' && current && <PhotoEditor product={current} onSaved={setProduct} />}
      {tab === 'stock' && current && <StockTab product={current} />}
    </Modal>
  );
}

// ───────────── Page ─────────────
export function ProductsPage() {
  const { can } = useAuth();
  const fmt = useFormat();
  const toast = useToast();
  const refresh = useRefreshProducts();
  const canManage = can('menu.manage');
  const showCost = can('reports.view');
  const products = useProducts(true);
  const [filter, setFilter] = useState<MenuGroup | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProductDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductDTO | null>(null);
  const remove = useMutation({
    mutationFn: (p: ProductDTO) => del(`/products/${p.id}`),
    onSuccess: (_d, p) => { toast('success', `“${p.name}” deleted`); setDeleting(null); refresh(); },
    onError: (e) => { toast('error', errorMessage(e)); setDeleting(null); },
  });
  const rows = (products.data ?? []).filter((p) => (filter === 'ALL' || p.group === filter) && p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const byCategory = rows.reduce<Map<string, ProductDTO[]>>((m, p) => m.set(p.categoryName, [...(m.get(p.categoryName) ?? []), p]), new Map());

  return (
    <div className="page" data-testid="products-page">
      <div className="page-head">
        <div>
          <h1>Menu items</h1>
          <p>Prices, recipes, options and how many of each can still be sold.</p>
        </div>
        {canManage && <button className="btn gold" onClick={() => setEditing('new')} data-testid="product-new"><Icon.plus width={20} /> New menu item</button>}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="segmented" role="group" aria-label="Filter by group">
          {(['ALL', ...MENU_GROUPS] as const).map((g) => <button key={g} aria-pressed={filter === g} onClick={() => setFilter(g)}>{g === 'ALL' ? 'All' : MENU_GROUP_LABELS[g]}</button>)}
        </div>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search items…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {products.isPending ? <Loading /> : products.isError ? <div className="alert error">{errorMessage(products.error)}</div> : rows.length === 0 ? (
        <div className="card empty">{products.data.length ? 'No items match.' : 'No menu items yet. Create your first item — e.g. Chicken Biriyani.'}</div>
      ) : (
        [...byCategory.entries()].map(([cat, items]) => (
          <section key={cat} className="card">
            <div className="card-header"><h3>{cat}</h3><span className="muted small">{items.length} item(s)</span></div>
            <div className="table-wrap">
              <table className="table" data-testid="products-table">
                <thead><tr><th>Item</th><th className="text-right">Price</th><th>Stock type</th><th className="text-right">Can sell now</th>{showCost && <th className="text-right">Cost · margin</th>}{canManage && <th />}</tr></thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={p.isActive ? '' : 'inactive'} data-testid="product-row">
                      <td>
                        <div className="row">
                          {p.hasImage ? <img className="thumb" src={`/api/products/${p.id}/image?v=${p.imageVersion}`} alt="" /> : <span className="thumb"><Icon.menu width={18} /></span>}
                          <div><b>{p.name}</b><div className="small muted">{p.station === 'BARISTA' ? 'Barista' : 'Kitchen'}{p.modifierGroups.length ? ` · ${p.modifierGroups.length} option group(s)` : ''}{p.isActive ? '' : ' · inactive'}</div></div>
                        </div>
                      </td>
                      <td className="num text-right"><b>{fmt.money(p.priceMinor)}</b></td>
                      <td><span className="badge neutral">{STOCK_MODE_SHORT[p.stockMode]}</span></td>
                      <td className="text-right" data-testid="product-available"><AvailabilityPill p={p} /></td>
                      {showCost && <td className="num text-right small">{p.costMinor !== null ? <>{fmt.money(p.costMinor)} · {p.priceMinor ? Math.round(((p.priceMinor - p.costMinor) / p.priceMinor) * 100) : 0}%</> : <span className="muted">—</span>}</td>}
                      {canManage && (
                        <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn ghost icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)} data-testid="product-edit"><Icon.edit width={20} /></button>
                          <button className="btn ghost icon" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Icon.trash width={20} /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      {editing && <ProductEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete menu item?" danger confirmLabel="Delete" busy={remove.isPending}
          message={<p>Delete <b>{deleting.name}</b>? Items with stock history cannot be deleted — untick “Active on the menu” instead.</p>}
          onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />
      )}
    </div>
  );
}
