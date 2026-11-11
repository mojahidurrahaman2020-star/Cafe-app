import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  formatDateTime,
  formatMoney,
  type BusinessSettingsDTO,
  type CurrencyConfig,
} from '@bitebrew/shared';
import { get } from '../api/client';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await get<{ settings: BusinessSettingsDTO }>('/settings')).settings,
    staleTime: 5 * 60_000,
  });
}

/** Formatting bound to the café's configured currency and timezone. */
export function useFormat() {
  const { data } = useSettings();
  const currency: CurrencyConfig = data
    ? {
        currencyCode: data.currencyCode,
        currencySymbol: data.currencySymbol,
        currencyDecimals: data.currencyDecimals,
        numberGrouping: data.numberGrouping,
      }
    : DEFAULT_CURRENCY;
  const timezone = data?.timezone ?? DEFAULT_TIMEZONE;
  return {
    currency,
    timezone,
    money: (minor: number) => formatMoney(minor, currency),
    dateTime: (d: Date | string) => formatDateTime(d, timezone),
  };
}

/** Ticking clock in the café's timezone (not the device's). */
export function useClock(timeZone: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(id);
  }, []);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: true }).format(now);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now);
  return { time, date };
}

export function useAppInfo() {
  return useQuery({
    queryKey: ['info'],
    queryFn: () => get<{ appEnv: string; version: string }>('/info'),
    staleTime: Infinity,
  });
}
