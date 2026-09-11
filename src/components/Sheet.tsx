import { useEffect, type ReactNode } from 'react';
import Button from './Button';

// Module-level scroll lock so nested sheets (e.g. ConfirmDialog over a Sheet)
// don't restore "hidden" when the inner one closes.
let openSheets = 0;
let savedOverflow = '';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** Sticky footer area, usually buttons. */
  footer?: ReactNode;
}

/** Bottom sheet modal. Backdrop tap and Escape close it. */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    if (openSheets++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      if (--openSheets === 0) document.body.style.overflow = savedOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="pb-safe relative max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-surface px-4 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        {title ? <h2 className="mb-3 text-lg font-semibold">{title}</h2> : null}
        <div className="pb-3">{children}</div>
        {footer ? <div className="sticky bottom-0 bg-surface pt-2 pb-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button red. Default true. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Yes/no confirmation built on `Sheet` — used for wipe, delete, finish. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" full onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} full onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message ? <div className="text-sm text-muted">{message}</div> : null}
    </Sheet>
  );
}

export default Sheet;
