/**
 * ESC/POS rendering for thermal printers. The printer-independent layout (tickets,
 * receipts, wrapping, "৳" → "Tk") lives in @bitebrew/shared/printing so the online demo
 * and the server produce identical printouts.
 */
import { renderLines, type PrintAlign as Align, type PrintPayload } from '@bitebrew/shared';
export { charsPerLine, renderLines, renderText, toPrintable, type PrintBlock as Block, type PrintPayload } from '@bitebrew/shared';

// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;
export const CMD = {
  init: [ESC, 0x40],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  sizeNormal: [GS, 0x21, 0x00],
  sizeDouble: [GS, 0x21, 0x11],
  align: (a: Align) => [ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0],
  feed: (n: number) => [ESC, 0x64, n],
  cut: [GS, 0x56, 0x42, 0x00], // feed and partial cut
  drawer: [ESC, 0x70, 0x00, 0x19, 0xfa], // pulse pin 2
};

export function renderEscPos(payload: PrintPayload, opts: { paperWidthMm: number; cut: boolean; openDrawer: boolean }): Buffer {
  const bytes: number[] = [...CMD.init];
  for (const l of renderLines(payload, opts.paperWidthMm)) {
    bytes.push(...CMD.align(l.align ?? 'left'));
    bytes.push(...(l.bold ? CMD.boldOn : CMD.boldOff));
    bytes.push(...(l.big ? CMD.sizeDouble : CMD.sizeNormal));
    bytes.push(...Buffer.from(l.text + '\n', 'ascii'));
  }
  bytes.push(...CMD.sizeNormal, ...CMD.boldOff, ...CMD.align('left'), ...CMD.feed(4));
  if (opts.cut) bytes.push(...CMD.cut);
  if (opts.openDrawer) bytes.push(...CMD.drawer);
  return Buffer.from(bytes);
}
