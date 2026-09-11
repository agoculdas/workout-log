import { useId, useState } from 'react';

/** Where a change came from: the text input, or one of the -/+ steppers. */
export type NumberFieldSource = 'input' | 'step';

export interface NumberFieldProps {
  /** Current value. `null` renders an empty field. */
  value: number | null;
  onChange: (value: number | null, source: NumberFieldSource) => void;
  /** Fired when the text input loses focus — a good place to flush a debounce. */
  onBlur?: () => void;
  label?: string;
  /** Right-hand unit hint inside the field, e.g. "kg/hand". */
  suffix?: string;
  /** Stepper step. Use 0.5/1/2.5 for loads, 1 for reps. Default 1. */
  step?: number;
  min?: number;
  max?: number;
  /** `decimal` for loads, `numeric` for reps. Default follows `step`. */
  inputMode?: 'decimal' | 'numeric';
  /** Small helper line under the field (e.g. the progression reason). */
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "2.5" -> 2.5, "" / "2." / "abc" -> null. Mirrors what onChange commits. */
function parseText(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : round(n);
}

/**
 * Big numeric input with -/+ steppers. 16px font so iOS never zooms on focus,
 * and 48px+ tap targets on the steppers.
 */
export function NumberField({
  value,
  onChange,
  label,
  suffix,
  step = 1,
  min = 0,
  max,
  inputMode,
  hint,
  placeholder,
  disabled = false,
  className = '',
  id,
  onBlur,
}: NumberFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const mode = inputMode ?? (Number.isInteger(step) ? 'numeric' : 'decimal');

  /**
   * The input is text-backed so a half-typed decimal ("2." on the way to
   * "2.5") survives the round trip through the parent, and so a parent that
   * debounces its commit does not yank the caret back. `lastProp` remembers
   * the value we last saw from above: when that changes and it disagrees with
   * what is typed, the outside value wins.
   */
  const [text, setText] = useState(() => (value === null ? '' : String(value)));
  const [lastProp, setLastProp] = useState<number | null>(value);
  if (value !== lastProp) {
    setLastProp(value);
    if (value !== parseText(text)) setText(value === null ? '' : String(value));
  }

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return round(out);
  };

  const bump = (delta: number) => {
    if (disabled) return;
    const next = clamp((value ?? 0) + delta);
    setLastProp(next);
    setText(String(next));
    onChange(next, 'step');
  };

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={fieldId} className="mb-1 block text-xs font-medium tracking-wide text-muted uppercase">
          {label}
        </label>
      ) : null}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label ?? 'value'}`}
          onClick={() => bump(-step)}
          disabled={disabled}
          className="h-14 w-14 shrink-0 rounded-xl border border-border bg-surface-2 text-2xl leading-none text-fg active:bg-border disabled:opacity-40"
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            id={fieldId}
            type="text"
            inputMode={mode}
            pattern={mode === 'decimal' ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              // Normalise "2." / "" on the way out, then let the parent flush.
              const parsed = parseText(text);
              setText(parsed === null ? '' : String(parsed));
              onBlur?.();
            }}
            onChange={(e) => {
              const raw = e.target.value.replace(',', '.').trim();
              setText(raw);
              if (raw === '') {
                setLastProp(null);
                return onChange(null, 'input');
              }
              const parsed = Number(raw);
              if (Number.isNaN(parsed)) return;
              const next = clamp(parsed);
              setLastProp(next);
              onChange(next, 'input');
            }}
            className="h-14 w-full rounded-xl border border-border bg-surface px-3 text-center text-2xl font-semibold tabular-nums text-fg outline-none focus:border-accent disabled:opacity-40"
          />
          {suffix ? (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">
              {suffix}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={`Increase ${label ?? 'value'}`}
          onClick={() => bump(step)}
          disabled={disabled}
          className="h-14 w-14 shrink-0 rounded-xl border border-border bg-surface-2 text-2xl leading-none text-fg active:bg-border disabled:opacity-40"
        >
          +
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export default NumberField;
