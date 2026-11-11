/**
 * Units of measurement. Ingredient stock is stored in the BASE unit of its dimension
 * (grams, millilitres, pieces); staff can enter and view any unit of the same dimension.
 * Conversions are exact decimal multiplications (factors are integers).
 */
export const DIMENSIONS = ['MASS', 'VOLUME', 'COUNT'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const UNITS = {
  g: { dimension: 'MASS', factor: 1, label: 'g', name: 'grams' },
  kg: { dimension: 'MASS', factor: 1000, label: 'kg', name: 'kilograms' },
  ml: { dimension: 'VOLUME', factor: 1, label: 'mL', name: 'millilitres' },
  l: { dimension: 'VOLUME', factor: 1000, label: 'L', name: 'litres' },
  pcs: { dimension: 'COUNT', factor: 1, label: 'pcs', name: 'pieces' },
  dozen: { dimension: 'COUNT', factor: 12, label: 'dozen', name: 'dozens' },
} as const satisfies Record<string, { dimension: Dimension; factor: number; label: string; name: string }>;

export type UnitCode = keyof typeof UNITS;
export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export const BASE_UNIT: Record<Dimension, UnitCode> = { MASS: 'g', VOLUME: 'ml', COUNT: 'pcs' };
export const DIMENSION_LABELS: Record<Dimension, string> = {
  MASS: 'Weight (g / kg)',
  VOLUME: 'Volume (mL / L)',
  COUNT: 'Count (pcs / dozen)',
};

export function unitsFor(dimension: Dimension): UnitCode[] {
  return UNIT_CODES.filter((u) => UNITS[u].dimension === dimension);
}

export function isUnitOf(unit: string, dimension: Dimension): unit is UnitCode {
  return unit in UNITS && UNITS[unit as UnitCode].dimension === dimension;
}

/** Round to 3 decimal places (the database precision for quantities). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Convert a quantity in `unit` to the base unit. Throws if the unit doesn't belong to the dimension. */
export function toBase(quantity: number, unit: UnitCode, dimension: Dimension): number {
  if (!isUnitOf(unit, dimension)) throw new Error(`Unit ${unit} cannot measure ${dimension.toLowerCase()}`);
  return round3(quantity * UNITS[unit].factor);
}

export function fromBase(baseQuantity: number, unit: UnitCode): number {
  return round3(baseQuantity / UNITS[unit].factor);
}

/** "12.5 kg" — trims trailing zeros. */
export function formatQty(baseQuantity: number, unit: UnitCode): string {
  const v = fromBase(baseQuantity, unit);
  return `${Number(v.toFixed(3)).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${UNITS[unit].label}`;
}
