import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRINTER_ROLE_LABELS, type PrinterDTO, type PrintJobDTO } from '@bitebrew/shared';
import { errorMessage, get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Loading, Modal, useToast } from '../components/ui';
import { useFormat } from '../lib/hooks';
import { usePrinters, usePrintJobs } from '../lib/queries';

const STATUS: Record<string, [string, string]> = { ONLINE: ['ok', 'Online'], OFFLINE: ['bad', 'Offline'], UNKNOWN: ['neutral', 'Checking…'], NOT_CONFIGURED: ['neutral', 'Not set up'] };

function PrinterCard({ p }: { p: PrinterDTO }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [d, setD] = useState({ name: p.name, host: p.host, port: String(p.port), paperWidthMm: p.paperWidthMm, isActive: p.isActive, cutPaper: p.cutPaper, openDrawer: p.openDrawer });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['printers'] }); void qc.invalidateQueries({ queryKey: ['print-jobs'] }); };
  const save = useMutation({
    mutationFn: () => patch(`/printers/${p.id}`, { ...d, port: Number(d.port), version: p.version }),
    onSuccess: () => { refresh(); toast('success', `${p.name} saved`); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const test = useMutation({ mutationFn: () => post(`/printers/${p.id}/test`), onSuccess: () => { refresh(); toast('success', 'Test page sent'); }, onError: (e) => toast('error', errorMessage(e)) });
  const [cls, label] = STATUS[p.status] ?? ['neutral', p.status];
  const manage = can('printers.manage');
  return (
    <section className="card card-pad stack" style={{ gap: 14 }} data-testid={`printer-${p.role}`}>
      <div className="row"><h2 style={{ fontSize: '1.1rem' }}>{PRINTER_ROLE_LABELS[p.role]}</h2><span className="spacer" /><span className={`badge ${cls}`}>{label}</span></div>
      <p className="small muted">
        {p.role === 'RECEIPT' ? 'Full customer receipt after payment.' : p.role === 'BARISTA' ? 'Drinks-only tickets (items whose station is Barista).' : 'Food-only tickets (items whose station is Kitchen).'}
        {p.pendingJobs ? ` · ${p.pendingJobs} waiting` : ''}{p.failedJobs ? ` · ${p.failedJobs} failed` : ''}
      </p>
      {p.lastError && p.status !== 'ONLINE' && <div className="alert error small">{p.lastError}</div>}
      <fieldset disabled={!manage} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="form-grid">
          <Field label="Name" htmlFor={`pn-${p.role}`}><input id={`pn-${p.role}`} className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Printer IP address" htmlFor={`ph-${p.role}`} hint="From the printer's self-test page, e.g. 192.168.1.50"><input id={`ph-${p.role}`} className="input" inputMode="decimal" placeholder="192.168.1.50" value={d.host} onChange={(e) => setD({ ...d, host: e.target.value.trim() })} data-testid={`printer-host-${p.role}`} /></Field>
          <Field label="Port" htmlFor={`pp-${p.role}`} hint="Usually 9100"><input id={`pp-${p.role}`} className="input num" inputMode="numeric" value={d.port} onChange={(e) => /^\d{0,5}$/.test(e.target.value) && setD({ ...d, port: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div className="segmented" role="group" aria-label="Paper width">
            {([80, 58] as const).map((w) => <button key={w} type="button" aria-pressed={d.paperWidthMm === w} onClick={() => setD({ ...d, paperWidthMm: w })}>{w} mm</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={d.cutPaper} onChange={(e) => setD({ ...d, cutPaper: e.target.checked })} /> Auto-cut</label>
          {p.role === 'RECEIPT' && <label className="check"><input type="checkbox" checked={d.openDrawer} onChange={(e) => setD({ ...d, openDrawer: e.target.checked })} /> Open cash drawer</label>}
          <label className="check"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> In use</label>
        </div>
      </fieldset>
      {manage && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" disabled={!p.host || test.isPending} onClick={() => test.mutate()}>Test print</button>
          <button className="btn" disabled={save.isPending} onClick={() => save.mutate()} data-testid={`printer-save-${p.role}`}>{save.isPending ? 'Checking…' : 'Save & check connection'}</button>
        </div>
      )}
    </section>
  );
}

function PreviewModal({ job, onClose }: { job: PrintJobDTO; onClose: () => void }) {
  const q = useQuery({ queryKey: ['print-preview', job.id], queryFn: async () => (await get<{ text: string }>(`/print-jobs/${job.id}/preview`)).text });
  const text = q.isPending ? null : q.data ?? 'Preview not available';
  return (
    <Modal title={`What the ${job.role.toLowerCase()} printer prints`} onClose={onClose}>
      {text === null ? <Loading /> : <pre className="receipt-preview" data-testid="print-preview">{text}</pre>}
    </Modal>
  );
}

export function PrintersPage() {
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const printers = usePrinters();
  const jobs = usePrintJobs({ limit: 40 });
  const [preview, setPreview] = useState<PrintJobDTO | null>(null);
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'retry' | 'cancel' }) => post(`/print-jobs/${id}/${what}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['print-jobs'] }); void qc.invalidateQueries({ queryKey: ['printers'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="page" data-testid="printers-page">
      <div className="page-head">
        <div>
          <h1>Printers</h1>
          <p>Every order is split automatically: the full receipt, drinks to the barista, food to the kitchen. Network (Ethernet / Wi-Fi) ESC/POS printers.</p>
        </div>
      </div>
      <div className="alert info small">
        Not yet tested with physical printers — they have not been bought. Until a printer is set up its tickets wait safely in the queue, and you can open any ticket below to see exactly what it will print.
        Use the compatibility checklist in docs/PRINTING.md before buying.
      </div>
      {printers.isPending ? <Loading /> : <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>{printers.data?.map((p) => <PrinterCard key={`${p.id}-${p.version}`} p={p} />)}</div>}
      <section className="card">
        <div className="card-header"><h3>Recent print jobs</h3></div>
        {jobs.isPending ? <Loading /> : !jobs.data?.length ? <div className="empty">No print jobs yet.</div> : (
          <div className="table-wrap">
            <table className="table" data-testid="print-jobs">
              <thead><tr><th>When</th><th>Printer</th><th>What</th><th>Status</th><th /></tr></thead>
              <tbody>
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td className="small num">{fmt.dateTime(j.createdAt)}</td>
                    <td>{j.role === 'RECEIPT' ? 'Receipt' : j.role === 'KITCHEN' ? 'Kitchen' : 'Barista'}</td>
                    <td className="small">{j.kind === 'TEST' ? 'Test page' : `${j.kind === 'RECEIPT' ? 'Receipt' : 'Ticket'} #${j.orderNo}`}{j.reprintNo ? ` · reprint ${j.reprintNo} (${j.reprintReason})` : ''}</td>
                    <td>
                      <span className={`badge ${j.status === 'PRINTED' ? 'ok' : j.status === 'FAILED' ? 'bad' : j.status === 'CANCELLED' ? 'neutral' : 'warn'}`}>{j.status.toLowerCase()}</span>
                      {j.lastError && <div className="small" style={{ color: 'var(--danger)', maxWidth: 320 }}>{j.lastError}</div>}
                    </td>
                    <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setPreview(j)}>View</button>
                      {j.status === 'FAILED' && <button className="btn sm secondary" onClick={() => act.mutate({ id: j.id, what: 'retry' })}>Print again</button>}
                      {(j.status === 'FAILED' || j.status === 'PENDING') && <button className="btn sm ghost" onClick={() => act.mutate({ id: j.id, what: 'cancel' })}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {preview && <PreviewModal job={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
