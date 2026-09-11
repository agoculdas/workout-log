import type { ReactNode } from 'react';

export interface ChipProps {
  children: ReactNode;
  /** Pressed state. Only meaningful together with `onClick`. */
  selected?: boolean;
  /** Omit to render a static label chip instead of a toggle button. */
  onClick?: () => void;
  /** Overrides the `aria-label` when the visible text is an abbreviation. */
  label?: string;
  className?: string;
}

/**
 * Pill-shaped filter / tag chip. Always at least 40px tall so it stays a
 * comfortable thumb target in a scrolling chip row.
 */
export function Chip({ children, selected = false, onClick, label, className = '' }: ChipProps) {
  // The label carries its own font-size: `index.css` sets an unlayered
  // `button { font-size: 16px }` (iOS zoom guard) that outranks any utility
  // class on the button element itself.
  const body = <span className="text-sm leading-none">{children}</span>;
  const base = [
    'inline-flex min-h-10 shrink-0 items-center rounded-full border px-3 whitespace-nowrap transition-colors',
    selected
      ? 'border-accent bg-accent font-medium text-[#14200a]'
      : 'border-border bg-surface text-muted',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!onClick) {
    return <span className={base}>{body}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={[base, selected ? 'active:bg-accent-strong' : 'active:bg-surface-2'].join(' ')}
    >
      {body}
    </button>
  );
}

export default Chip;
