/**
 * Business time helpers. All timestamps are stored in UTC. They are displayed
 * and grouped into "business days" in the café's configured timezone
 * (Asia/Dhaka by default), never in the device's own timezone — a tablet with
 * a wrong clock zone must not shift reports.
 */

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Returns YYYY-MM-DD for the instant in the given timezone. */
export function businessDate(at: Date, timeZone: string, dayStartHour = 0): string {
  const shifted = new Date(at.getTime() - dayStartHour * 3_600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatDateTime(at: Date | string, timeZone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Current UTC offset of a zone, e.g. "+06:00". */
export function utcOffset(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-]\d{2}:\d{2})?/);
  return m?.[1] ?? '+00:00';
}
