import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type IconButtonVariant = 'default' | 'danger';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the glyph is never a name. Becomes the `aria-label`. */
  label: string;
  variant?: IconButtonVariant;
  children: ReactNode;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  default: 'border-border bg-surface-2 text-fg active:bg-border',
  danger: 'border-border bg-surface-2 text-danger active:bg-border',
};

/**
 * A square 44px glyph button — reorder arrows, remove, edit. Thumb-sized by
 * design: the glyphs themselves are small, the target never is.
 */
export function IconButton({
  label,
  variant = 'default',
  className = '',
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={[
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
        'disabled:opacity-30 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {/* `index.css` sets an unlayered `button { font-size: 16px }` (the iOS
          zoom guard), so the glyph carries its size on a child span. */}
      <span aria-hidden="true" className="text-sm leading-none">
        {children}
      </span>
    </button>
  );
}

export default IconButton;
