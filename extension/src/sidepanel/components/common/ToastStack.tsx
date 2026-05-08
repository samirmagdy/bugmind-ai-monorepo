import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';

const ToastStack: React.FC = () => {
  const { session, updateSession } = useBugMind();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visibleToasts = useMemo(
    () => (session.toastHistory || []).filter((toast) => !dismissed.has(toast.id)).slice(0, 3),
    [dismissed, session.toastHistory]
  );

  useEffect(() => {
    if (visibleToasts.length === 0) return;
    const timers = visibleToasts.map((toast, index) => window.setTimeout(() => {
      setDismissed((current) => new Set(current).add(toast.id));
    }, 5200 + index * 800));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [visibleToasts]);

  const removeToast = (toastId: string) => {
    setDismissed((current) => new Set(current).add(toastId));
    updateSession({
      toastHistory: (session.toastHistory || []).filter((toast) => toast.id !== toastId)
    });
  };

  if (visibleToasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {visibleToasts.map((toast) => {
        const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : Info;
        return (
          <div key={toast.id} className={`toast-card toast-card-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <Icon size={16} className="toast-icon" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-bold text-[var(--text-primary)]">{toast.title}</div>
              {toast.detail && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--text-secondary)]">{toast.detail}</div>}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="toast-close"
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastStack;
