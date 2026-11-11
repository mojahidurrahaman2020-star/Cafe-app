import { formatDateTime } from './time.js';
import { formatMoney } from './money.js';
import { SERVICE_LABELS, type PrinterRole } from './pos.js';

/**
 * Printer-independent ticket/receipt content and its ESC/POS rendering.
 *
 * Payloads are stored on print_jobs as plain data so a job can be re-rendered for any
 * printer (58 mm ≈ 32 characters, 80 mm ≈ 48 characters per line).
 * Thermal printers' built-in code pages do not contain "৳" or Bangla: the renderer prints
 * "Tk" for the taka sign and replaces other non-ASCII characters (documented limitation;
 * bitmap rendering of Bangla names is a possible later addition after printer testing).
 */
export type PrintAlign = 'left' | 'center' | 'right';
export type PrintBlock =
  | { t: 'text'; text: string; bold?: boolean; big?: boolean; align?: PrintAlign }
  | { t: 'pair'; left: string; right: string; bold?: boolean; big?: boolean }
  | { t: 'rule' }
  | { t: 'feed'; lines?: number };

export interface PrintPayload {
  blocks: PrintBlock[];
}

export const charsPerLine = (paperWidthMm: number) => (paperWidthMm === 58 ? 32 : 48);

export function toPrintable(s: string): string {
  return s
    .replace(/৳\s?/g, 'Tk ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/×/g, 'x')
    .replace(/[é]/g, 'e')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { out.push(cur); cur = w; }
    while (cur.length > width) { out.push(cur.slice(0, width)); cur = cur.slice(width); }
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

/** Plain-text rendering (used for the on-screen preview and as the basis of ESC/POS). */
export function renderLines(payload: PrintPayload, paperWidthMm: number): { text: string; bold?: boolean; big?: boolean; align?: PrintAlign }[] {
  const width = charsPerLine(paperWidthMm);
  const out: { text: string; bold?: boolean; big?: boolean; align?: PrintAlign }[] = [];
  for (const b of payload.blocks) {
    if (b.t === 'rule') out.push({ text: '-'.repeat(width) });
    else if (b.t === 'feed') for (let i = 0; i < (b.lines ?? 1); i++) out.push({ text: '' });
    else if (b.t === 'text') {
      const w = b.big ? Math.floor(width / 2) : width;
      for (const line of wrap(toPrintable(b.text), w)) out.push({ text: line, bold: b.bold, big: b.big, align: b.align });
    } else {
      const w = b.big ? Math.floor(width / 2) : width;
      const right = toPrintable(b.right);
      const leftLines = wrap(toPrintable(b.left), Math.max(8, w - right.length - 1));
      leftLines.forEach((l, i) => {
        const r = i === leftLines.length - 1 ? right : '';
        out.push({ text: l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r, bold: b.bold, big: b.big });
      });
    }
  }
  return out;
}

export function renderText(payload: PrintPayload, paperWidthMm: number): string {
  const width = charsPerLine(paperWidthMm);
  return renderLines(payload, paperWidthMm)
    .map((l) => {
      const w = l.big ? Math.floor(width / 2) : width;
      if (l.align === 'center') return ' '.repeat(Math.max(0, Math.floor((w - l.text.length) / 2))) + l.text;
      if (l.align === 'right') return ' '.repeat(Math.max(0, w - l.text.length)) + l.text;
      return l.text;
    })
    .join('\n');
}


export type PrintableOrder = {
  id: string; orderNo: number; serviceType: 'DINE_IN' | 'TAKEAWAY'; tableNo: string | null; customerName: string; notes: string;
  createdAt: Date; subtotalMinor: number; discountMinor: number; discountReason: string | null; taxMinor: number; totalMinor: number;
  paidMinor: number; taxSnapshot: unknown;
  lines: { name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; modifiers: unknown; notes: string; station: 'KITCHEN' | 'BARISTA'; prepStatus: string }[];
  payments?: { methodName: string; amountMinor: number; tenderedMinor: number | null; changeMinor: number; reference: string | null }[];
};
export type PrintSettings = { businessName: string; tagline: string; address: string; phone: string; receiptFooter: string; taxRegistration: string; timezone: string; currencyCode: string; currencySymbol: string; currencyDecimals: number; numberGrouping: 'LAKH' | 'INTERNATIONAL' };

const mods = (m: unknown) => ((m as { name: string }[]) ?? []).map((x) => x.name);

export function ticketPayload(o: PrintableOrder, station: 'KITCHEN' | 'BARISTA', s: PrintSettings, opts: { cancelled?: boolean; reprint?: number } = {}): PrintPayload | null {
  const lines = o.lines.filter((l) => l.station === station && (opts.cancelled || l.prepStatus !== 'CANCELLED'));
  if (!lines.length) return null;
  const blocks: PrintBlock[] = [
    { t: 'text', text: station === 'KITCHEN' ? 'KITCHEN' : 'BARISTA', bold: true, align: 'center' },
  ];
  if (opts.cancelled) blocks.push({ t: 'text', text: '*** CANCELLED ***', big: true, bold: true, align: 'center' });
  if (opts.reprint) blocks.push({ t: 'text', text: `REPRINT #${opts.reprint}`, bold: true, align: 'center' });
  blocks.push(
    { t: 'text', text: `#${o.orderNo}  ${o.serviceType === 'DINE_IN' ? `TABLE ${o.tableNo ?? '?'}` : 'TAKEAWAY'}`, big: true, bold: true, align: 'center' },
    { t: 'text', text: formatDateTime(o.createdAt, s.timezone) + (o.customerName ? ` · ${o.customerName}` : ''), align: 'center' },
    { t: 'rule' },
  );
  for (const l of lines) {
    blocks.push({ t: 'text', text: `${l.quantity} x ${l.name}`, big: true, bold: true });
    for (const m of mods(l.modifiers)) blocks.push({ t: 'text', text: `   + ${m}` , bold: true });
    if (l.notes) blocks.push({ t: 'text', text: `   NOTE: ${l.notes}`, bold: true });
  }
  if (o.notes) blocks.push({ t: 'rule' }, { t: 'text', text: `ORDER NOTE: ${o.notes}`, bold: true });
  blocks.push({ t: 'rule' });
  return { blocks };
}

export function receiptPayload(o: PrintableOrder, s: PrintSettings, opts: { reprint?: number } = {}): PrintPayload {
  const cur = { currencyCode: s.currencyCode, currencySymbol: s.currencySymbol, currencyDecimals: s.currencyDecimals, numberGrouping: s.numberGrouping };
  const m = (v: number) => formatMoney(v, cur);
  const blocks: PrintBlock[] = [
    { t: 'text', text: s.businessName, big: true, bold: true, align: 'center' },
    { t: 'text', text: s.tagline, align: 'center' },
  ];
  if (s.address) blocks.push({ t: 'text', text: s.address, align: 'center' });
  if (s.phone) blocks.push({ t: 'text', text: s.phone, align: 'center' });
  if (s.taxRegistration) blocks.push({ t: 'text', text: s.taxRegistration, align: 'center' });
  if (opts.reprint) blocks.push({ t: 'text', text: `REPRINT #${opts.reprint}`, bold: true, align: 'center' });
  blocks.push(
    { t: 'rule' },
    { t: 'pair', left: `Order #${o.orderNo}`, right: SERVICE_LABELS[o.serviceType] + (o.tableNo ? ` T${o.tableNo}` : ''), bold: true },
    { t: 'text', text: formatDateTime(o.createdAt, s.timezone) },
    { t: 'rule' },
  );
  for (const l of o.lines.filter((x) => x.prepStatus !== 'CANCELLED')) {
    blocks.push({ t: 'pair', left: `${l.quantity} x ${l.name}`, right: m(l.lineTotalMinor) });
    for (const mod of mods(l.modifiers)) blocks.push({ t: 'text', text: `   + ${mod}` });
  }
  blocks.push({ t: 'rule' }, { t: 'pair', left: 'Subtotal', right: m(o.subtotalMinor) });
  if (o.discountMinor) blocks.push({ t: 'pair', left: `Discount${o.discountReason ? ` (${o.discountReason})` : ''}`, right: `-${m(o.discountMinor)}` });
  for (const t of (o.taxSnapshot as { name: string; rateBp: number; inclusive: boolean; amountMinor: number }[]) ?? []) {
    blocks.push({ t: 'pair', left: `${t.name} ${(t.rateBp / 100).toFixed(2).replace(/\.?0+$/, '')}%${t.inclusive ? ' (incl.)' : ''}`, right: m(t.amountMinor) });
  }
  blocks.push({ t: 'pair', left: 'TOTAL', right: m(o.totalMinor), bold: true, big: true }, { t: 'rule' });
  for (const p of o.payments ?? []) {
    blocks.push({ t: 'pair', left: p.methodName + (p.reference ? ` (${p.reference})` : ''), right: m(p.amountMinor) });
    if (p.tenderedMinor && p.changeMinor) blocks.push({ t: 'pair', left: '  Cash given', right: m(p.tenderedMinor) }, { t: 'pair', left: '  Change', right: m(p.changeMinor) });
  }
  blocks.push({ t: 'feed' }, { t: 'text', text: s.receiptFooter, align: 'center' });
  return { blocks };
}

export function testPayload(role: PrinterRole, printerName: string, paperWidthMm: number, s: PrintSettings): PrintPayload {
  const width = paperWidthMm === 58 ? 32 : 48;
  return {
    blocks: [
      { t: 'text', text: s.businessName, big: true, bold: true, align: 'center' },
      { t: 'text', text: 'PRINTER TEST', bold: true, align: 'center' },
      { t: 'rule' },
      { t: 'pair', left: 'Printer', right: printerName },
      { t: 'pair', left: 'Role', right: role },
      { t: 'pair', left: 'Paper', right: `${paperWidthMm} mm / ${width} chars` },
      { t: 'pair', left: 'Time', right: formatDateTime(new Date(), s.timezone) },
      { t: 'text', text: '1234567890'.repeat(Math.ceil(width / 10)).slice(0, width) },
      { t: 'text', text: 'Bold text', bold: true },
      { t: 'text', text: 'BIG TEXT', big: true },
      { t: 'pair', left: 'Amount', right: 'Tk 1,250.00' },
      { t: 'rule' },
    ],
  };
}

