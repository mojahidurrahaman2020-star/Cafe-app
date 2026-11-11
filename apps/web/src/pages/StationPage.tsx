import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StationTicketDTO } from '@bitebrew/shared';
import { errorMessage, get, post } from '../api/client';
import { Loading, useToast } from '../components/ui';
import { usePrinters } from '../lib/queries';

const NEXT: Record<string, string> = { PENDING: 'Start', PREPARING: 'Ready', READY: 'Served' };

function age(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : `${m} min`;
}

export function StationPage({ station }: { station: 'kitchen' | 'barista' }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t); }, []);
  const q = useQuery({
    queryKey: ['station', station],
    queryFn: async () => (await get<{ tickets: StationTicketDTO[] }>(`/stations/${station}`)).tickets,
    refetchInterval: 15_000, // safety net in addition to live updates
  });
  const printers = usePrinters();
  const printer = printers.data?.find((p) => p.role === (station === 'kitchen' ? 'KITCHEN' : 'BARISTA'));
  const advance = useMutation({
    mutationFn: (orderId: string) => post<{ status: string }>(`/stations/${station}/orders/${orderId}/advance`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['station'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const tickets = q.data ?? [];
  return (
    <div className="page" style={{ maxWidth: 'none' }} data-testid={`station-${station}`}>
      <div className="page-head">
        <div>
          <h1>{station === 'kitchen' ? 'Kitchen' : 'Barista'} orders</h1>
          <p>{tickets.length} order(s) in progress · updates automatically</p>
        </div>
        {printer && (
          <span className={`badge ${printer.status === 'ONLINE' ? 'ok' : printer.status === 'NOT_CONFIGURED' ? 'neutral' : 'bad'}`}>
            Printer: {printer.status === 'NOT_CONFIGURED' ? 'not set up' : printer.status.toLowerCase()}{printer.failedJobs ? ` · ${printer.failedJobs} failed` : ''}
          </span>
        )}
      </div>
      {q.isPending ? <Loading /> : tickets.length === 0 ? (
        <div className="card empty" style={{ padding: 60 }}>No {station === 'kitchen' ? 'food' : 'drink'} orders waiting. New orders appear here instantly.</div>
      ) : (
        <div className="kds">
          {tickets.map((t) => {
            const lowest = t.lines.reduce((m, l) => (['PENDING', 'PREPARING', 'READY'].indexOf(l.prepStatus) < ['PENDING', 'PREPARING', 'READY'].indexOf(m) ? l.prepStatus : m), 'READY' as string);
            const mins = (now - Date.parse(t.createdAt)) / 60000;
            return (
              <article key={t.orderId} className={`ticket ${lowest.toLowerCase()} ${mins > 15 ? 'late' : ''}`} data-testid="kds-ticket">
                <header>
                  <span className="no">#{t.orderNo}</span>
                  <span>{t.serviceType === 'DINE_IN' ? `Table ${t.tableNo}` : 'Takeaway'}</span>
                  <span className="age">{age(t.createdAt, now)}</span>
                </header>
                <ul>
                  {t.lines.map((l) => (
                    <li key={l.id} className={l.prepStatus.toLowerCase()}>
                      <b>{l.quantity} × {l.name}</b>
                      {l.modifiers.length > 0 && <div className="mods">{l.modifiers.map((m) => m.name).join(' · ')}</div>}
                      {l.notes && <div className="note">{l.notes}</div>}
                    </li>
                  ))}
                </ul>
                {t.notes && <div className="note">Order note: {t.notes}</div>}
                <button className={`btn ${lowest === 'READY' ? 'gold' : ''}`} disabled={advance.isPending} onClick={() => advance.mutate(t.orderId)} data-testid="kds-advance">
                  {NEXT[lowest]}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
