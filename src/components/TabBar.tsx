import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Tab {
  to: string;
  label: string;
  icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const TABS: Tab[] = [
  {
    to: '/',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path {...stroke} d="M4 11h2v2H4zM18 11h2v2h-2z" />
        <path {...stroke} d="M6 8h3v8H6zM15 8h3v8h-3zM9 12h6" />
      </svg>
    ),
  },
  {
    to: '/history',
    label: 'History',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path {...stroke} d="M4 19V5M4 19h16" />
        <path {...stroke} d="M7 15l4-5 3 3 4-6" />
      </svg>
    ),
  },
  {
    to: '/programme',
    label: 'Programme',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path {...stroke} d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <circle {...stroke} cx="12" cy="12" r="3" />
        <path
          {...stroke}
          d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        />
      </svg>
    ),
  },
];

/** Bottom navigation. Hidden on the session route by `App`. */
export function TabBar() {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-surface/95 backdrop-blur">
      <ul className="mx-auto flex max-w-md items-stretch">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
                  isActive ? 'text-accent' : 'text-muted',
                ].join(' ')
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default TabBar;
