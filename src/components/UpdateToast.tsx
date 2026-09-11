import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import Button from './Button';

/**
 * Registers the service worker and offers a reload when a new build is waiting.
 * `registerType: 'autoUpdate'` means the new SW takes over on the next load; this
 * toast just makes that immediate and visible.
 */
export function UpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => async () => {
          await updateSW(true);
        });
        setNeedRefresh(true);
      },
    });
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-40 flex items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 shadow-lg"
    >
      <span className="flex-1 text-sm">Update available</span>
      <Button
        size="sm"
        onClick={() => {
          void update?.();
        }}
      >
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)} aria-label="Dismiss">
        ✕
      </Button>
    </div>
  );
}

export default UpdateToast;
