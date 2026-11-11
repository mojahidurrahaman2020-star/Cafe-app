import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney, utcOffset, type BusinessSettingsDTO, type NumberGrouping } from '@bitebrew/shared';
import { ApiError, errorMessage, patch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, Loading, useToast } from '../components/ui';
import { useSettings } from '../lib/hooks';

type Editable = Omit<BusinessSettingsDTO, 'version' | 'updatedAt'>;

const COMMON_ZONES = ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'UTC'];

function allZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    return intl.supportedValuesOf?.('timeZone') ?? COMMON_ZONES;
  } catch {
    return COMMON_ZONES;
  }
}

export function SettingsPage() {
  const { can } = useAuth();
  const readOnly = !can('settings.manage');
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Editable | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const zones = useMemo(allZones, []);

  useEffect(() => {
    if (settings.data && !draft) {
      const { version: _v, updatedAt: _u, ...rest } = settings.data;
      setDraft(rest);
    }
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: () => patch<{ settings: BusinessSettingsDTO }>('/settings', { ...draft, version: settings.data!.version }),
    onSuccess: ({ settings: s }) => {
      qc.setQueryData(['settings'], s);
      const { version: _v, updatedAt: _u, ...rest } = s;
      setDraft(rest);
      toast('success', 'Settings saved');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        if (err.code === 'STALE_VERSION') {
          void qc.invalidateQueries({ queryKey: ['settings'] });
          setDraft(null); // reload the latest values
        }
      }
      setFormError(errorMessage(err));
    },
  });

  if (settings.isPending || !draft) return <div className="page"><Loading /></div>;
  if (settings.isError) return <div className="page"><div className="alert error">{errorMessage(settings.error)}</div></div>;

  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setDraft({ ...draft, [k]: v });
  const dirty = settings.data && (Object.keys(draft) as (keyof Editable)[]).some((k) => draft[k] !== settings.data![k]);
  const preview = formatMoney(1_23_456_78, {
    currencyCode: draft.currencyCode,
    currencySymbol: draft.currencySymbol || '৳',
    currencyDecimals: draft.currencyDecimals,
    numberGrouping: draft.numberGrouping,
  });
  let tzPreview = '';
  try {
    tzPreview = `${new Intl.DateTimeFormat('en-GB', { timeZone: draft.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date())} (UTC${utcOffset(draft.timezone)})`;
  } catch {
    tzPreview = 'Invalid timezone';
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    save.mutate();
  };

  return (
    <form className="page" onSubmit={submit} data-testid="settings-form">
      <div className="page-head">
        <div>
          <h1>Business settings</h1>
          <p>
            {readOnly ? 'View only — only the owner can change business settings.' : 'Changes apply to every device immediately after saving.'}
          </p>
        </div>
        {!readOnly && (
          <div className="row">
            <button type="button" className="btn secondary" disabled={!dirty || save.isPending} onClick={() => { setDraft(null); setErrors({}); setFormError(null); }}>
              Discard
            </button>
            <button type="submit" className="btn gold" disabled={!dirty || save.isPending} data-testid="settings-save">
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
      {formError && <div className="alert error" role="alert">{formError}</div>}

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
        <section className="card card-pad stack" style={{ gap: 18 }}>
          <h2>Business</h2>
          <div className="form-grid">
            <Field label="Business name" htmlFor="s-name" error={errors.businessName}>
              <input id="s-name" className="input" value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
            </Field>
            <Field label="Tagline" htmlFor="s-tag" error={errors.tagline}>
              <input id="s-tag" className="input" value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} />
            </Field>
            <Field label="Established" htmlFor="s-est" error={errors.establishedYear}>
              <input id="s-est" className="input num" type="number" inputMode="numeric" value={draft.establishedYear} onChange={(e) => set('establishedYear', Number(e.target.value))} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Address" htmlFor="s-addr" error={errors.address}>
              <input id="s-addr" className="input" value={draft.address} onChange={(e) => set('address', e.target.value)} data-testid="settings-address" />
            </Field>
            <Field label="Phone" htmlFor="s-phone" error={errors.phone}>
              <input id="s-phone" className="input" type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="s-email" error={errors.email}>
              <input id="s-email" className="input" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 18 }}>
          <h2>Currency</h2>
          <div className="form-grid">
            <Field label="Currency code (ISO 4217)" htmlFor="s-cur" error={errors.currencyCode}>
              <input id="s-cur" className="input" maxLength={3} value={draft.currencyCode} onChange={(e) => set('currencyCode', e.target.value.toUpperCase())} data-testid="settings-currency-code" />
            </Field>
            <Field label="Symbol" htmlFor="s-sym" error={errors.currencySymbol}>
              <input id="s-sym" className="input" maxLength={5} value={draft.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} />
            </Field>
            <Field label="Decimal places" htmlFor="s-dec" hint="BDT uses 2 (paisa)" error={errors.currencyDecimals}>
              <select id="s-dec" className="input" value={draft.currencyDecimals} onChange={(e) => set('currencyDecimals', Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Digit grouping" htmlFor="s-grp" error={errors.numberGrouping}>
              <select id="s-grp" className="input" value={draft.numberGrouping} onChange={(e) => set('numberGrouping', e.target.value as NumberGrouping)}>
                <option value="LAKH">Lakh / crore (1,23,456)</option>
                <option value="INTERNATIONAL">International (123,456)</option>
              </select>
            </Field>
          </div>
          <p className="muted">Preview: <b className="num" data-testid="currency-preview">{preview}</b></p>
          <p className="muted small">Tax / VAT rates are configured with the POS module (Phase 3). No tax rate is assumed.</p>
        </section>

        <section className="card card-pad stack" style={{ gap: 18 }}>
          <h2>Time</h2>
          <div className="form-grid">
            <Field label="Timezone" htmlFor="s-tz" error={errors.timezone}>
              <select id="s-tz" className="input" value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} data-testid="settings-timezone">
                {!zones.includes(draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </Field>
            <Field label="Business day starts at" htmlFor="s-day" hint="Sales after midnight but before this hour count toward the previous day" error={errors.businessDayStartHour}>
              <select id="s-day" className="input" value={draft.businessDayStartHour} onChange={(e) => set('businessDayStartHour', Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </Field>
          </div>
          <p className="muted">Café time now: <b data-testid="tz-preview">{tzPreview}</b></p>
        </section>

        <section className="card card-pad stack" style={{ gap: 18 }}>
          <h2>Service &amp; receipts</h2>
          <div className="form-grid">
            <label className="check"><input type="checkbox" checked={draft.dineInEnabled} onChange={(e) => set('dineInEnabled', e.target.checked)} /> Dine-in enabled</label>
            <label className="check"><input type="checkbox" checked={draft.takeawayEnabled} onChange={(e) => set('takeawayEnabled', e.target.checked)} /> Takeaway enabled</label>
          </div>
          <Field label="Receipt footer" htmlFor="s-foot" error={errors.receiptFooter}>
            <textarea id="s-foot" className="input" maxLength={300} value={draft.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
          </Field>
        </section>
      </fieldset>
      {settings.data && <p className="muted small">Revision {settings.data.version} · last saved {new Date(settings.data.updatedAt).toLocaleString('en-GB', { timeZone: settings.data.timezone })}</p>}
    </form>
  );
}
