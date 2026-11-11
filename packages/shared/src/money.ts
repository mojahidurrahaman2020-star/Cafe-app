/**
 * Money is always stored and transported as an integer number of the
 * currency's minor unit (paisa for BDT: ৳1 = 100 paisa). Floating-point
 * values are never used for money.
 */

export type NumberGrouping = 'LAKH' | 'INTERNATIONAL';

export interface CurrencyConfig {
  currencyCode: string; // ISO 4217, e.g. "BDT"
  currencySymbol: string; // e.g. "৳"
  currencyDecimals: number; // 2 for BDT
  numberGrouping: NumberGrouping;
}

export const DEFAULT_CURRENCY: CurrencyConfig = {
  currencyCode: 'BDT',
  currencySymbol: '৳',
  currencyDecimals: 2,
  numberGrouping: 'LAKH',
};

/** Group an integer string: LAKH → 1,23,45,678 ; INTERNATIONAL → 12,345,678 */
function groupDigits(int: string, grouping: NumberGrouping): string {
  if (grouping === 'INTERNATIONAL') return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export function formatMoney(minor: number | bigint, cfg: CurrencyConfig = DEFAULT_CURRENCY): string {
  const big = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor));
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const factor = 10n ** BigInt(cfg.currencyDecimals);
  const whole = (abs / factor).toString();
  const frac = (abs % factor).toString().padStart(cfg.currencyDecimals, '0');
  const body = groupDigits(whole, cfg.numberGrouping) + (cfg.currencyDecimals > 0 ? `.${frac}` : '');
  return `${negative ? '-' : ''}${cfg.currencySymbol}${body}`;
}

/** Parse user input such as "1,250.50" or "৳1250" into minor units. Returns null if invalid. */
export function parseMoney(input: string, decimals = 2): number | null {
  const cleaned = input.replace(/[৳,\s]/g, '').replace(/^BDT/i, '');
  const re = new RegExp(`^-?\\d+(\\.\\d{0,${decimals}})?$`);
  if (!re.test(cleaned)) return null;
  const [w, f = ''] = cleaned.replace('-', '').split('.');
  const minor = Number(w) * 10 ** decimals + Number(f.padEnd(decimals, '0') || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return cleaned.startsWith('-') ? -minor : minor;
}
