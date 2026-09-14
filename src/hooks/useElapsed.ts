import { useEffect, useState } from 'react';

/**
 * Milliseconds since `startedAt`, re-rendered once a second.
 *
 * The clock is derived from `Date.now()` rather than counted up, so a phone
 * that froze the timer while the screen was off (or a tab that was throttled)
 * shows the right number the moment it comes back, not the number it would
 * have reached had anyone been watching.
 *
 * Pass `running: false` — a finished session, say — and the value is computed
 * once against `until` (or now) and left alone.
 */
export function useElapsed(
  startedAt: number | undefined,
  opts: { running?: boolean; until?: number } = {},
): number {
  const running = opts.running !== false;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || startedAt === undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  if (startedAt === undefined) return 0;
  const end = running ? now : (opts.until ?? now);
  return Math.max(0, end - startedAt);
}

export default useElapsed;
