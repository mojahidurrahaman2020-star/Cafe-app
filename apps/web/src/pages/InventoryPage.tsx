import { useState } from 'react';
import { formatQty, STOCK_MODE_SHORT, UNITS, type IngredientDTO, type ProductDTO, type SupplierDTO } from '@bitebrew/shared';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { Tabs } from '../components/inputs';
import { AdjustDialog, IngredientForm, ReceiveDialog, ReceivePortionsDialog, SupplierForm } from '../components/stockDialogs';
import { Loading, Modal } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { useIngredients, useMovements, useProducts, useSuppliers } from '../lib/queries';

type Tab = 'ingredients' | 'portions' | 'suppliers' | 'history';

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Opening', RECEIVE: 'Received', PRODUCTION_CONSUME: 'Used in batch', SALE_CONSUME: 'Used in sale',
  SALE_REVERSAL: 'Sale reversed', WASTE: 'Waste', SPOILAGE: 'Spoilage', ADJUSTMENT: 'Correction', COUNT: 'Stock count',
  PRODUCED: 'Prepared', SOLD: 'Sold',
};

export function StockHistory({ kind, itemId, limit = 50 }: { kind?: 'INGREDIENT' | 'FINISHED'; itemId?: string; limit?: number }) {
  const fmt = useFormat();
  const { can } = useAuth();
  const q = useMovements({ kind, itemId, limit });
  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="alert error">{errorMessage(q.error)}</div>;
  if (!q.data.length) return <div className="empty">No stock movements yet.</div>;
  const showValue = can('reports.view');
  return (
    <div className="table-wrap">
      <table className="table" data-testid="movements-table">
        <thead><tr><th>When</th>{!itemId && <th>Item</th>}<th>Type</th><th className="text-right">Change</th><th className="text-right">Balance</th>{showValue && <th className="text-right">Value</th>}<th>By / note</th></tr></thead>
        <tbody>
          {q.data.map((m) => {
            const show = (n: number) => (m.unit === 'portion' ? `${n}` : formatQty(n, m.unit));
            return (
              <tr key={m.id}>
                <td className="small num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(m.occurredAt)}</td>
                {!itemId && <td>{m.itemName}</td>}
                <td><span className="badge neutral">{MOVEMENT_LABELS[m.type] ?? m.type}</span></td>
                <td className={`num text-right ${m.qtyDelta < 0 ? '' : ''}`} style={{ color: m.qtyDelta < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{m.qtyDelta > 0 ? '+' : ''}{show(m.qtyDelta)}</td>
                <td className="num text-right">{show(m.balanceAfter)}</td>
                {showValue && <td className="num text-right">{fmt.money(m.valueMinor)}</td>}
                <td className="small muted">{[m.actor, m.reason].filter(Boolean).join(' · ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IngredientsTab() {
  const { can } = useAuth();
  const fmt = useFormat();
  const [showInactive, setShowInactive] = useState(false);
  const list = useIngredients(showInactive);
  const [dialog, setDialog] = useState<null | { type: 'receive' | 'adjust' | 'edit' | 'history'; item: IngredientDTO } | { type: 'new' }>(null);
  const showValue = can('reports.view');
  const rows = list.data ?? [];
  const totalValue = rows.reduce((s, i) => s + i.stockValueMinor, 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
        <span className="spacer" />
        {showValue && <span className="muted">Raw stock value: <b className="num">{fmt.money(totalValue)}</b></span>}
        {can('inventory.adjust') && <button className="btn gold" onClick={() => setDialog({ type: 'new' })} data-testid="ingredient-new"><Icon.plus width={20} /> New ingredient</button>}
      </div>
      <div className="card">
        {list.isPending ? <Loading /> : list.isError ? <div className="alert error" style={{ margin: 16 }}>{errorMessage(list.error)}</div> : rows.length === 0 ? (
          <div className="empty">No ingredients yet. Add rice, chicken, milk, coffee beans, cups…</div>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="ingredients-table">
              <thead><tr><th>Ingredient</th><th className="text-right">On hand</th><th className="text-right">Minimum</th><th>Status</th>{showValue && <th className="text-right">Avg cost</th>}{showValue && <th className="text-right">Value</th>}<th /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={i.isActive ? '' : 'inactive'} data-testid="ingredient-row">
                    <td><b>{i.name}</b><div className="small muted">{[i.supplier?.name, i.isPackaging ? 'Packaging' : null, i.usedInProducts ? `in ${i.usedInProducts} recipe(s)` : null].filter(Boolean).join(' · ')}</div></td>
                    <td className="num text-right" data-testid="ingredient-onhand"><b>{formatQty(i.onHand, i.displayUnit)}</b></td>
                    <td className="num text-right muted">{i.minLevel ? formatQty(i.minLevel, i.displayUnit) : '—'}</td>
                    <td>{i.onHand <= 0 ? <span className="badge bad">Out</span> : i.isLow ? <span className="badge warn">Low</span> : <span className="badge ok">OK</span>}</td>
                    {showValue && <td className="num text-right small">{fmt.money(Math.round(i.avgCostMinor * UNITS[i.displayUnit].factor))}/{UNITS[i.displayUnit].label}</td>}
                    {showValue && <td className="num text-right">{fmt.money(i.stockValueMinor)}</td>}
                    <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                      {can('purchases.manage') && i.isActive && <button className="btn sm secondary" onClick={() => setDialog({ type: 'receive', item: i })} data-testid="ingredient-receive">Receive</button>}{' '}
                      {can('inventory.adjust') && <button className="btn sm secondary" onClick={() => setDialog({ type: 'adjust', item: i })} data-testid="ingredient-adjust">Adjust</button>}{' '}
                      <button className="btn ghost icon" aria-label={`History of ${i.name}`} onClick={() => setDialog({ type: 'history', item: i })}><Icon.audit width={20} /></button>
                      {can('inventory.adjust') && <button className="btn ghost icon" aria-label={`Edit ${i.name}`} onClick={() => setDialog({ type: 'edit', item: i })}><Icon.edit width={20} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog?.type === 'new' && <IngredientForm initial={null} onClose={() => setDialog(null)} />}
      {dialog?.type === 'edit' && <IngredientForm initial={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'receive' && <ReceiveDialog ingredient={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'adjust' && <AdjustDialog target={{ kind: 'ingredient', item: dialog.item }} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && <HistoryModal title={dialog.item.name} kind="INGREDIENT" itemId={dialog.item.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function HistoryModal({ title, kind, itemId, onClose }: { title: string; kind: 'INGREDIENT' | 'FINISHED'; itemId: string; onClose: () => void }) {
  return <Modal title={`Stock history — ${title}`} onClose={onClose} wide><StockHistory kind={kind} itemId={itemId} /></Modal>;
}

function PortionsTab() {
  const { can } = useAuth();
  const fmt = useFormat();
  const products = useProducts(false);
  const [dialog, setDialog] = useState<null | { type: 'adjust' | 'receive' | 'history'; item: ProductDTO }>(null);
  const rows = (products.data ?? []).filter((p) => p.stockMode === 'BATCH' || p.stockMode === 'RESALE');
  const showValue = can('reports.view');
  return (
    <div className="card">
      {products.isPending ? <Loading /> : rows.length === 0 ? <div className="empty">No batch-cooked or ready-made items yet. Set a menu item's stock type to “Batch” or “Ready-made”.</div> : (
        <div className="table-wrap">
          <table className="table" data-testid="portions-table">
            <thead><tr><th>Item</th><th>Type</th><th className="text-right">Portions on hand</th>{showValue && <th className="text-right">Cost / portion</th>}<th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><div className="small muted">{p.categoryName}</div></td>
                  <td><span className="badge neutral">{STOCK_MODE_SHORT[p.stockMode]}</span></td>
                  <td className="text-right"><span className={`qty-pill ${p.portionsOnHand <= 0 ? 'out' : p.portionsOnHand <= 5 ? 'low' : 'good'}`}>{p.portionsOnHand}</span></td>
                  {showValue && <td className="num text-right">{p.costMinor !== null ? fmt.money(p.costMinor) : '—'}</td>}
                  <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                    {p.stockMode === 'RESALE' && can('purchases.manage') && <button className="btn sm secondary" onClick={() => setDialog({ type: 'receive', item: p })}>Receive</button>}{' '}
                    {can('inventory.adjust') && <button className="btn sm secondary" onClick={() => setDialog({ type: 'adjust', item: p })} data-testid="portion-adjust">Adjust</button>}{' '}
                    <button className="btn ghost icon" aria-label={`History of ${p.name}`} onClick={() => setDialog({ type: 'history', item: p })}><Icon.audit width={20} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog?.type === 'adjust' && <AdjustDialog target={{ kind: 'portions', item: dialog.item }} onClose={() => setDialog(null)} />}
      {dialog?.type === 'receive' && <ReceivePortionsDialog product={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && <HistoryModal title={dialog.item.name} kind="FINISHED" itemId={dialog.item.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SuppliersTab() {
  const { can } = useAuth();
  const list = useSuppliers();
  const [editing, setEditing] = useState<SupplierDTO | 'new' | null>(null);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {can('purchases.manage') && <div className="row"><span className="spacer" /><button className="btn gold" onClick={() => setEditing('new')} data-testid="supplier-new"><Icon.plus width={20} /> New supplier</button></div>}
      <div className="card">
        {list.isPending ? <Loading /> : !list.data?.length ? <div className="empty">No suppliers yet.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Supplier</th><th>Phone</th><th>Address</th><th /></tr></thead>
            <tbody>{list.data.map((s) => (
              <tr key={s.id} className={s.isActive ? '' : 'inactive'}>
                <td><b>{s.name}</b>{s.notes && <div className="small muted">{s.notes}</div>}</td><td>{s.phone || '—'}</td><td className="small">{s.address || '—'}</td>
                <td className="text-right">{can('purchases.manage') && <button className="btn ghost icon" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Icon.edit width={20} /></button>}</td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      {editing && <SupplierForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('ingredients');
  return (
    <div className="page" data-testid="inventory-page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p>Raw ingredients in stock, prepared portions, suppliers and every stock movement.</p>
        </div>
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'ingredients', label: 'Ingredients' },
        { id: 'portions', label: 'Portions & ready-made' },
        { id: 'suppliers', label: 'Suppliers' },
        { id: 'history', label: 'Stock history' },
      ]} />
      {tab === 'ingredients' && <IngredientsTab />}
      {tab === 'portions' && <PortionsTab />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'history' && <div className="card"><StockHistory limit={100} /></div>}
    </div>
  );
}
