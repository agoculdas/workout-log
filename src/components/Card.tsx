import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover/press feedback — use when the whole card is tappable. */
  interactive?: boolean;
  /** Drops the default padding (for cards that manage their own rows). */
  flush?: boolean;
  children?: ReactNode;
}

export function Card({
  interactive = false,
  flush = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        'rounded-2xl border border-border/70 bg-surface',
        flush ? '' : 'p-4',
        interactive ? 'active:bg-surface-2 cursor-pointer' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
