import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatQty, fromBase, type ProductionBatchDTO, type ProductionPreviewDTO, type UnitCode } from '@bitebrew/shared';
import { ApiError, errorMessage, get, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { QtyInput, Stepper } from '../components/inputs';
import { useInvalidateStock } from '../components/stockDialogs';
import { Field, Loading, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { requestId } from '../lib/ids';
import { useIngredients, useProducts } from '../lib/queries';
import { AvailabilityPill } from './ProductsPage';

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function ProductionPage() {
  const fmt = useFormat();
  const toast = useToast();
  const { can } = useAuth();
  const refresh = useInvalidateStock();
  const products = useProducts(false);
  const ingredients = useIngredients(false);
  const batchItems = (products.data ?? []).filter((p) => p.stockMode === 'BATCH');
  const [productId, setProductId] = useState('');
  const [portions, setPortions] = useState(20);
  const [notes, setNotes] = useState('');
  const [useActual, setUseActual] = useState(false);
  const [actual, setActual] = useState<Record<string, { quantity: string; unit: UnitCode }>>({});
  const [rid, setRid] = useState(requestId);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(portions);
  const showCost = can('reports.view');

  const preview = useQuery({
    queryKey: ['production-preview', productId, debounced],
    queryFn: async () => (await get<{ preview: ProductionPreviewDTO }>(`/production/preview?productId=${productId}&portions=${debounced}`)).preview,
    enabled: !!productId && debounced > 0,
    retry: false,
  });
  const batches = useQuery({
    queryKey: ['batches'],
    queryFn: async () => (await get<{ batches: ProductionBatchDTO[] }>('/production/batches?limit=20')).batches,
  });

  useEffect(() => {
    // reset "actual amounts" to the recipe amounts whenever the plan changes
    if (!preview.data) return;
    setActual(Object.fromEntries(preview.data.requirements.map((r) => [r.ingredientId, { quantity: String(fromBase(r.required, r.displayUnit)), unit: r.displayUnit }])));
  }, [preview.data]);

  const record = useMutation({
    mutationFn: () =>
      post<{ batch: ProductionBatchDTO }>('/production/batches', {
        productId,
        portions,
        notes: notes || undefined,
        requestId: rid,
        overrides: useActual ? Object.entries(actual).map(([ingredientId, a]) => ({ ingredientId, quantity: Number(a.quantity || 0), unit: a.unit })) : undefined,
      }),
    onSuccess: ({ batch }) => {
      toast('success', `Batch #${batch.batchNo}: ${batch.portions} × ${batch.productName} added to stock`);
      refresh();
      setRid(requestId());
      setNotes('');
      setUseActual(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        const s = (e.details as { shortages: { name: string }[] }).shortages;
        setError(`${e.message}: ${s.map((x) => x.name).join(', ')}`);
      } else setError(errorMessage(e));
    },
  });

  const selected = batchItems.find((p) => p.id === productId);
  const pv = preview.data;
  const ingById = new Map((ingredients.data ?? []).map((i) => [i.id, i]));

  return (
    <div className="page" data-testid="production-page">
      <div className="page-head">
        <div>
          <h1>Production</h1>
          <p>Record batch cooking. Ingredients are deducted once, and the portions become available to sell.</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="card card-pad stack" style={{ gap: 16 }}>
          <h2>1. What was prepared?</h2>
          {products.isPending ? <Loading /> : batchItems.length === 0 ? (
            <div className="empty">No batch-cooked items yet. On Menu items, set an item's stock type to “Batch cooked” and give it a recipe.</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {batchItems.map((p) => (
                <button key={p.id} type="button" className={`btn ${productId === p.id ? '' : 'secondary'}`} style={{ justifyContent: 'space-between', minHeight: 56 }}
                  onClick={() => { setProductId(p.id); setError(null); setRid(requestId()); }} data-testid="production-item">
                  <span>{p.name}{p.recipe.length === 0 && ' (no recipe yet)'}</span>
                  <AvailabilityPill p={p} />
                </button>
              ))}
            </div>
          )}
          <Field label="Portions prepared" htmlFor="pr-portions">
            <Stepper id="pr-portions" value={portions} onChange={(n) => { setPortions(n); setRid(requestId()); }} />
          </Field>
          <Field label="Notes (optional)" htmlFor="pr-notes"><input id="pr-notes" className="input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </section>

        <section className="card card-pad stack" style={{ gap: 16 }}>
          <h2>2. Ingredients used</h2>
          {!productId ? <div className="empty">Choose an item.</div> : preview.isPending ? <Loading /> : preview.isError ? (
            <div className="alert error">{errorMessage(preview.error)}</div>
          ) : pv && (
            <>
              <div className="table-wrap">
                <table className="table" data-testid="production-preview">
                  <thead><tr><th>Ingredient</th><th className="text-right">Needed</th><th className="text-right">In stock</th>{showCost && <th className="text-right">Cost</th>}</tr></thead>
                  <tbody>
                    {pv.requirements.map((r) => (
                      <tr key={r.ingredientId}>
                        <td>{r.ingredientName}{r.shortBy > 0 && <div className="small" style={{ color: 'var(--danger)', fontWeight: 700 }}>Short by {formatQty(r.shortBy, r.displayUnit)}</div>}</td>
                        <td className="num text-right">
                          {useActual && ingById.get(r.ingredientId) ? (
                            <QtyInput id={`act-${r.ingredientId}`} dimension={ingById.get(r.ingredientId)!.dimension} quantity={actual[r.ingredientId]?.quantity ?? ''} unit={actual[r.ingredientId]?.unit ?? r.displayUnit}
                              onChange={(q, u) => setActual({ ...actual, [r.ingredientId]: { quantity: q, unit: u } })} />
                          ) : <b>{formatQty(r.required, r.displayUnit)}</b>}
                        </td>
                        <td className="num text-right">{formatQty(r.onHand, r.displayUnit)}</td>
                        {showCost && <td className="num text-right">{fmt.money(r.costMinor)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="check"><input type="checkbox" checked={useActual} onChange={(e) => setUseActual(e.target.checked)} /> Amounts used were different from the recipe</label>
              {showCost && <p className="muted">Batch cost <b className="num">{fmt.money(pv.totalCostMinor)}</b> · <b className="num">{fmt.money(pv.unitCostMinor)}</b> per portion</p>}
              {!pv.canProduce && !useActual && <div className="alert warn">Not enough stock for {portions} portions. Up to <b>{pv.maxPortions}</b> can be made now — or record a delivery first.</div>}
              {error && <div className="alert error" role="alert">{error}</div>}
              <button className="btn gold" style={{ minHeight: 56, fontSize: '1.05rem' }} disabled={record.isPending || (!pv.canProduce && !useActual) || portions !== debounced}
                onClick={() => { setError(null); record.mutate(); }} data-testid="production-record">
                {record.isPending ? 'Recording…' : `Record ${portions} × ${selected?.name ?? ''}`}
              </button>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header"><h3>Recent batches</h3></div>
        {batches.isPending ? <Loading /> : !batches.data?.length ? <div className="empty">No batches recorded yet.</div> : (
          <div className="table-wrap">
            <table className="table" data-testid="batches-table">
              <thead><tr><th>#</th><th>When</th><th>Item</th><th className="text-right">Portions</th>{showCost && <th className="text-right">Cost / portion</th>}<th>By</th><th>Notes</th></tr></thead>
              <tbody>
                {batches.data.map((b) => (
                  <tr key={b.id}>
                    <td className="num">{b.batchNo}</td>
                    <td className="small num">{fmt.dateTime(b.preparedAt)}</td>
                    <td><b>{b.productName}</b></td>
                    <td className="num text-right">{b.portions}</td>
                    {showCost && <td className="num text-right">{fmt.money(b.unitCostMinor)}</td>}
                    <td className="small">{b.preparedBy ?? '—'}</td>
                    <td className="small muted">{b.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
