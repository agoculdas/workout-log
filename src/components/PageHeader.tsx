import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Rendered to the right of the title (a button, a count, ...). */
  action?: ReactNode;
  /** Rendered to the left of the title (a back button). */
  leading?: ReactNode;
  /** Sticks to the top of the scroll container. Default true. */
  sticky?: boolean;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  action,
  leading,
  sticky = true,
  className = '',
}: PageHeaderProps) {
  return (
    <header
      className={[
        sticky ? 'sticky top-0 z-20' : '',
        'pt-safe bg-bg/90 backdrop-blur-sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-muted">{subtitle}</div> : null}
        </div>
        {action}
      </div>
    </header>
  );
}

export default PageHeader;
