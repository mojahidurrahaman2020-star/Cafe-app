import { describe, expect, it } from 'vitest';
import {
  businessDate,
  canManageRole,
  formatMoney,
  hasPermission,
  isValidTimeZone,
  parseMoney,
  utcOffset,
} from './index.js';

describe('money', () => {
  it('formats BDT minor units with the taka sign and lakh grouping', () => {
    expect(formatMoney(0)).toBe('৳0.00');
    expect(formatMoney(25050)).toBe('৳250.50');
    expect(formatMoney(12_345_678_90)).toBe('৳1,23,45,678.90');
    expect(formatMoney(-1500)).toBe('-৳15.00');
  });
  it('supports international grouping', () => {
    expect(
      formatMoney(12_345_678_90, {
        currencyCode: 'BDT',
        currencySymbol: '৳',
        currencyDecimals: 2,
        numberGrouping: 'INTERNATIONAL',
      }),
    ).toBe('৳12,345,678.90');
  });
  it('parses user input safely', () => {
    expect(parseMoney('1,250.5')).toBe(125050);
    expect(parseMoney('৳ 99')).toBe(9900);
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('time', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Dhaka')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
  it('Asia/Dhaka is UTC+06:00', () => {
    expect(utcOffset('Asia/Dhaka')).toBe('+06:00');
  });
  it('computes the business date in Dhaka, not UTC', () => {
    // 2027-01-01 20:30 UTC is 2027-01-02 02:30 in Dhaka
    const at = new Date('2027-01-01T20:30:00Z');
    expect(businessDate(at, 'Asia/Dhaka')).toBe('2027-01-02');
    // With a 3am business-day start, 02:30 still belongs to the previous day
    expect(businessDate(at, 'Asia/Dhaka', 3)).toBe('2027-01-01');
  });
});

describe('roles', () => {
  it('enforces the matrix', () => {
    expect(hasPermission('OWNER', 'settings.manage')).toBe(true);
    expect(hasPermission('MANAGER', 'settings.manage')).toBe(false);
    expect(hasPermission('CASHIER', 'menu.manage')).toBe(false);
    expect(hasPermission('KITCHEN', 'kitchen.view')).toBe(true);
    expect(hasPermission('BARISTA', 'kitchen.view')).toBe(false);
  });
  it('limits account management by rank', () => {
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageRole('MANAGER', 'CASHIER')).toBe(true);
    expect(canManageRole('MANAGER', 'MANAGER')).toBe(false);
    expect(canManageRole('MANAGER', 'OWNER')).toBe(false);
    expect(canManageRole('CASHIER', 'BARISTA')).toBe(false);
  });
});

import { formatQty, fromBase, toBase, unitsFor } from './index.js';
describe('units', () => {
  it('converts kg↔g and L↔mL exactly', () => {
    expect(toBase(2.5, 'kg', 'MASS')).toBe(2500);
    expect(toBase(0.125, 'l', 'VOLUME')).toBe(125);
    expect(toBase(2, 'dozen', 'COUNT')).toBe(24);
    expect(fromBase(1250, 'kg')).toBe(1.25);
    expect(fromBase(330, 'l')).toBe(0.33);
    expect(toBase(0.1 + 0.2, 'kg', 'MASS')).toBe(300); // float noise removed
  });
  it('refuses cross-dimension conversions', () => {
    expect(() => toBase(1, 'kg', 'VOLUME')).toThrow();
    expect(unitsFor('VOLUME')).toEqual(['ml', 'l']);
  });
  it('formats quantities', () => {
    expect(formatQty(12500, 'kg')).toBe('12.5 kg');
    expect(formatQty(1500, 'ml')).toBe('1,500 mL');
  });
});
