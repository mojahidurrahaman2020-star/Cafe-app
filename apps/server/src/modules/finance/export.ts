import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatMoney, type ReportDTO } from '@bitebrew/shared';

type Row = (string | number)[];

/** Report as sections of rows (money in taka with 2 decimals for spreadsheets). */
export function reportSections(r: ReportDTO): { title: string; header: string[]; rows: Row[] }[] {
  const tk = (m: number) => Math.round(m) / 100;
  return [
    {
      title: 'Summary', header: ['Measure', 'Amount (BDT)'],
      rows: [
        ['Orders', r.orders], ['Items sold', r.itemsSold], ['Gross sales (before discounts)', tk(r.grossSalesMinor)], ['Discounts', tk(r.discountsMinor)],
        ['Tax / VAT collected', tk(r.taxMinor)], ['Refunds', tk(r.refundsMinor)], ['Net sales (excl. tax)', tk(r.netSalesMinor)],
        ['Cost of goods sold (COGS)', tk(r.cogsMinor)], ['Gross profit', tk(r.grossProfitMinor)], ['Inventory losses (waste, spoilage, corrections)', tk(r.inventoryLossesMinor)],
        ['Operating expenses', tk(r.expensesMinor)], ['Net profit (estimate)', tk(r.netProfitMinor)],
        ['Inventory purchases (stock bought — not COGS)', tk(r.inventoryPurchasesMinor)], ['Average order', tk(r.averageOrderMinor)], ['Cancelled orders', r.cancelledOrders],
      ],
    },
    { title: 'By period', header: ['Period', 'Net sales', 'Orders', 'COGS', 'Expenses'], rows: r.series.map((s) => [s.period, tk(s.salesMinor), s.orders, tk(s.cogsMinor), tk(s.expensesMinor)]) },
    { title: 'Payment methods', header: ['Method', 'Received', 'Refunded', 'Net'], rows: r.paymentMethods.map((m) => [m.name, tk(m.receivedMinor), tk(m.refundedMinor), tk(m.netMinor)]) },
    { title: 'Categories', header: ['Category', 'Quantity', 'Revenue'], rows: r.categories.map((c) => [c.name, c.quantity, tk(c.revenueMinor)]) },
    { title: 'Best sellers', header: ['Item', 'Quantity', 'Revenue'], rows: r.topItems.map((c) => [c.name, c.quantity, tk(c.revenueMinor)]) },
    { title: 'Expenses', header: ['Category', 'Amount'], rows: r.expensesByCategory.map((e) => [e.name, tk(e.amountMinor)]) },
  ];
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Guard against spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportCsv(r: ReportDTO, businessName: string) {
  const out: string[] = [`${csvCell(businessName)} report,${r.from} to ${r.to}`];
  for (const s of reportSections(r)) {
    out.push('', csvCell(s.title), s.header.map(csvCell).join(','));
    for (const row of s.rows) out.push(row.map(csvCell).join(','));
  }
  return '﻿' + out.join('\r\n'); // BOM so Excel opens UTF-8 correctly
}

export async function reportXlsx(r: ReportDTO, businessName: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = businessName;
  for (const s of reportSections(r)) {
    const ws = wb.addWorksheet(s.title);
    ws.addRow([`${businessName} — ${s.title}`, `${r.from} to ${r.to}`]).font = { bold: true };
    ws.addRow([]);
    const h = ws.addRow(s.header);
    h.font = { bold: true };
    for (const row of s.rows) ws.addRow(row);
    ws.columns.forEach((c, i) => {
      c.width = i === 0 ? 44 : 16;
      if (i > 0) c.numFmt = '#,##0.00';
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportPdf(r: ReportDTO, s: { businessName: string; tagline: string; currencyCode: string; currencySymbol: string; currencyDecimals: number; numberGrouping: 'LAKH' | 'INTERNATIONAL' }): Promise<Buffer> {
  // PDF core fonts cannot draw "৳", so amounts use the ISO code (BDT 1,250.00).
  const money = (m: number) => formatMoney(m, { ...s, currencySymbol: `${s.currencyCode} ` });
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica-Bold').fontSize(18).text(s.businessName.replace(/[^\x20-\x7E]/g, ''));
    doc.font('Helvetica').fontSize(10).fillColor('#6b5546').text(`${s.tagline.replace(/[^\x20-\x7E]/g, '')}  ·  Report ${r.from} to ${r.to}`);
    doc.moveDown();
    for (const sec of reportSections(r)) {
      if (!sec.rows.length) continue;
      doc.fillColor('#3b2418').font('Helvetica-Bold').fontSize(12).text(sec.title);
      doc.moveDown(0.3);
      const widths = sec.header.length === 2 ? [330, 170] : sec.header.length === 3 ? [260, 100, 140] : sec.header.length === 4 ? [200, 100, 100, 100] : [140, 100, 70, 90, 100];
      const row = (cells: (string | number)[], bold = false) => {
        const y = doc.y;
        let x = 48;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#2a1a10');
        cells.forEach((c, i) => {
          const txt = typeof c === 'number' && i > 0 && sec.header[i] !== 'Orders' && sec.header[i] !== 'Quantity' && !(sec.title === 'Summary' && ['Orders', 'Items sold', 'Cancelled orders'].includes(String(cells[0]))) ? money(Math.round(c * 100)) : String(c).replace(/[^\x20-\x7E]/g, '');
          doc.text(txt, x, y, { width: widths[i]! - 8, align: i === 0 ? 'left' : 'right' });
          x += widths[i]!;
        });
        doc.y = Math.max(doc.y, y + 14);
        doc.x = 48;
        if (doc.y > 760) doc.addPage();
      };
      row(sec.header, true);
      for (const r2 of sec.rows) row(r2);
      doc.moveDown();
    }
    doc.fontSize(8).fillColor('#6b5546').text('Net profit is an estimate: net sales minus cost of goods sold, inventory losses and recorded operating expenses. Inventory purchases are stock (an asset), not an expense.', 48);
    doc.end();
  });
}
