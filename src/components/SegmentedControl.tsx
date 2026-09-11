import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** Announced as the group's name. */
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Equal-width tab strip: one row of options, the active one filled in accent.
 * Used for the Programme's Days / Library switch and its four-day picker.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className={['grid gap-1 rounded-xl border border-border/70 bg-surface p-1', className]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={typeof option.label === 'string' ? option.label : undefined}
            onClick={() => onChange(option.value)}
            className={[
              'min-h-11 rounded-lg px-1 transition-colors',
              active ? 'bg-accent text-[#14200a]' : 'text-muted active:bg-surface-2',
            ].join(' ')}
          >
            <span className="block truncate text-xs font-medium">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
