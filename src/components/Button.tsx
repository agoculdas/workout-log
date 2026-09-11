import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Defaults to `lg` — thumb-sized targets everywhere. */
  size?: ButtonSize;
  /** Stretch to the container width. */
  full?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-[#14200a] active:bg-accent-strong font-semibold',
  secondary: 'bg-surface-2 text-fg border border-border active:bg-border',
  danger: 'bg-danger text-white active:bg-danger-strong font-semibold',
  ghost: 'bg-transparent text-muted active:bg-surface-2',
};

const SIZES: Record<ButtonSize, string> = {
  lg: 'min-h-14 px-5 text-base rounded-2xl',
  md: 'min-h-12 px-4 text-base rounded-xl',
  sm: 'min-h-11 px-3 text-sm rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'lg',
  full = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 select-none transition-colors',
        'disabled:opacity-40 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        VARIANTS[variant],
        SIZES[size],
        full ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
