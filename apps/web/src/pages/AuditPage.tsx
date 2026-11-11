import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditLogDTO } from '@bitebrew/shared';
import { errorMessage, get } from '../api/client';
import { Loading } from '../components/ui';
import { useFormat } from '../lib/hooks';

function diff(before: unknown, after: unknown): string {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return '';
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => !['version', 'updatedAt'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`)
    .join('; ');
}

export function AuditPage() {
  const fmt = useFormat();
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      get<{ entries: AuditLogDTO[]; nextBefore: string | null }>(`/audit?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Append-only record of sign-ins and sensitive changes. Entries cannot be edited or deleted.</p>
        </div>
      </div>
      <div className="card">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <div className="alert error" style={{ margin: 16 }}>{errorMessage(q.error)}</div>
        ) : entries.length === 0 ? (
          <div className="empty">No entries yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="small num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(e.occurredAt)}</td>
                    <td>{e.actor ? e.actor.fullName : <span className="muted">System</span>}</td>
                    <td><code className="small">{e.action}</code></td>
                    <td className="small muted" style={{ maxWidth: 520, wordBreak: 'break-word' }}>
                      {diff(e.before, e.after) || (e.after && typeof e.after === 'object' && 'name' in e.after ? String((e.after as { name: string }).name) : '') || (e.before && typeof e.before === 'object' && 'name' in e.before ? String((e.before as { name: string }).name) : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {q.hasNextPage && (
        <button className="btn secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
        </button>
      )}
    </div>
  );
}
