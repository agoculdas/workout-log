import { useEffect } from 'react';

/**
 * Holds a screen wake lock while `enabled` is true.
 *
 * The browser releases the lock on its own whenever the tab is hidden (locking
 * the phone, switching apps), and never hands it back automatically — so the
 * hook re-acquires on `visibilitychange` as well. Everything is feature
 * detected and every rejection swallowed: a missing or refused wake lock is a
 * lost nicety, never an error the gym floor should see.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const api = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;
    if (!api?.request) return;

    let released = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = () => {
      if (released || sentinel !== null) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void api
        .request('screen')
        .then((lock) => {
          if (released) {
            void lock.release().catch(() => undefined);
            return;
          }
          sentinel = lock;
          // The lock can drop without us asking; forget it so we can re-request.
          lock.addEventListener('release', () => {
            if (sentinel === lock) sentinel = null;
          });
        })
        .catch(() => undefined);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const lock = sentinel;
      sentinel = null;
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [enabled]);
}

export default useWakeLock;
