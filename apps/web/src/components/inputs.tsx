import { useEffect, useState } from 'react';
import { UNITS, unitsFor, type Dimension, type UnitCode } from '@bitebrew/shared';

/** Taka amount input. Value is paisa (integer) or null when empty/invalid. */
export function MoneyInput({
  id,
  value,
  onChange,
  symbol = '৳',
  allowNegative = false,
  invalid,
  testId,
}: {
  id: string;
  value: number | null;
  onChange: (minor: number | null) => void;
  symbol?: string;
  allowNegative?: boolean;
  invalid?: boolean;
  testId?: string;
}) {
  const fmt = (v: number | null) => (v === null ? '' : (v / 100).toFixed(2).replace(/\.00$/, ''));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  function parse(t: string): number | null {
    const c = t.replace(/[,\s৳]/g, '');
    if (!c) return null;
    if (!(allowNegative ? /^-?\d+(\.\d{0,2})?$/ : /^\d+(\.\d{0,2})?$/).test(c)) return null;
    return Math.round(Number(c) * 100);
  }
  return (
    <div className="input-affix">
      <span>{symbol}</span>
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        value={text}
        aria-invalid={invalid}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
      />
    </div>
  );
}

/** Quantity + unit picker limited to the item's dimension. */
export function QtyInput({
  id,
  dimension,
  quantity,
  unit,
  onChange,
  allowNegative = false,
  testId,
}: {
  id: string;
  dimension: Dimension;
  quantity: string;
  unit: UnitCode;
  onChange: (quantity: string, unit: UnitCode) => void;
  allowNegative?: boolean;
  testId?: string;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        value={quantity}
        style={{ flex: 1, minWidth: 0 }}
        data-testid={testId}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || (allowNegative ? /^-?\d*(\.\d{0,3})?$/ : /^\d*(\.\d{0,3})?$/).test(v)) onChange(v, unit);
        }}
      />
      <select className="input" style={{ width: 110 }} value={unit} aria-label="Unit" onChange={(e) => onChange(quantity, e.target.value as UnitCode)}>
        {unitsFor(dimension).map((u) => (
          <option key={u} value={u}>{UNITS[u].label}</option>
        ))}
      </select>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; hidden?: boolean }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} type="button" data-testid={`tab-${t.id}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Large touch stepper for whole numbers (portions). */
export function Stepper({ value, onChange, min = 1, max = 10000, id }: { value: number; onChange: (n: number) => void; min?: number; max?: number; id: string }) {
  return (
    <div className="stepper">
      <button type="button" className="btn secondary" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</button>
      <input id={id} className="input num" inputMode="numeric" value={value} onChange={(e) => {
        const n = Number(e.target.value.replace(/\D/g, ''));
        if (Number.isFinite(n)) onChange(Math.min(max, n));
      }} />
      <button type="button" className="btn secondary" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">+</button>
    </div>
  );
}
