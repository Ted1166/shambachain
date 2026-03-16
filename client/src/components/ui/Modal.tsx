import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  maxWidth?: number;
}

export function Modal({ open, onClose, title, subtitle, icon, children, maxWidth = 540 }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            {icon && <span className="modal-icon">{icon}</span>}
            <div>
              <h2 className="modal-title">{title}</h2>
              {subtitle && <p className="modal-sub">{subtitle}</p>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}