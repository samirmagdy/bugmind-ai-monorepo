import React from 'react';
import { LucideIcon } from 'lucide-react';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function toneClasses(tone: Tone): { text: string; softBg: string; softBorder: string; glow: string } {
  switch (tone) {
    case 'success':
      return {
        text: 'text-[var(--status-success)]',
        softBg: 'bg-[var(--status-success)]/10',
        softBorder: 'border-[var(--status-success)]/20',
        glow: 'shadow-[var(--status-success)]/5'
      };
    case 'warning':
      return {
        text: 'text-[var(--status-warning)]',
        softBg: 'bg-[var(--status-warning)]/10',
        softBorder: 'border-[var(--status-warning)]/20',
        glow: 'shadow-[var(--status-warning)]/5'
      };
    case 'danger':
      return {
        text: 'text-[var(--status-danger)]',
        softBg: 'bg-[var(--status-danger)]/10',
        softBorder: 'border-[var(--status-danger)]/20',
        glow: 'shadow-[var(--status-danger)]/5'
      };
    case 'neutral':
      return {
        text: 'text-[var(--text-main)]',
        softBg: 'bg-[var(--bg-input)]',
        softBorder: 'border-[var(--border-main)]',
        glow: 'shadow-black/5'
      };
    case 'info':
    default:
      return {
        text: 'text-[var(--status-info)]',
        softBg: 'bg-[var(--status-info)]/10',
        softBorder: 'border-[var(--status-info)]/20',
        glow: 'shadow-[var(--status-info)]/5'
      };
  }
}

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cx('luxury-panel', className)}>
    {children}
  </div>
);

export const SectionTitle: React.FC<{
  title: string;
  subtitle?: string;
  className?: string;
}> = ({ title, subtitle, className }) => (
  <div className={cx('space-y-1', className)}>
    <h2 className="text-xl font-black tracking-tighter luxury-heading">{title}</h2>
    {subtitle ? (
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 bg-[var(--status-info)]/30 rounded-full" />
        <p className="luxury-subheading normal-case tracking-tight opacity-40">{subtitle}</p>
      </div>
    ) : null}
  </div>
);

export const FieldLabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <label className={cx('ds-field-label', className)}>{children}</label>
);

export const StatusBadge: React.FC<{
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}> = ({ children, tone = 'info', className }) => {
  const colors = toneClasses(tone);
  return (
    <span className={cx(
      'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] border',
      colors.softBg,
      colors.softBorder,
      colors.text,
      className
    )}>
      {children}
    </span>
  );
};

export const StatusPanel: React.FC<{
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  tone?: Tone;
  className?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ icon: Icon, title, description, tone = 'info', className, action, children }) => {
  const colors = toneClasses(tone);

  return (
    <div className={cx(
      'relative overflow-hidden rounded-[1.5rem] border p-4 shadow-xl',
      colors.softBg,
      colors.softBorder,
      colors.glow,
      className
    )}>
      <div className={cx('absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-current to-transparent opacity-30', colors.text)} />
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className={cx(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-inner',
              colors.softBg,
              colors.softBorder,
              colors.text
            )}>
              <Icon size={16} />
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-tight text-[var(--text-main)]">{title}</p>
            {description ? (
              <div className="mt-1 text-[11px] font-medium leading-relaxed text-[var(--text-muted)]">
                {description}
              </div>
            ) : null}
          </div>
          {action ? (
            <div className="shrink-0 self-start">
              {action}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
};

export const ActionButton: React.FC<{
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  variant?: ButtonVariant;
  tone?: Tone;
  className?: string;
}> = ({ children, onClick, type = 'button', disabled, variant = 'secondary', tone = 'info', className }) => {
  const colors = toneClasses(tone);

  const variantClass =
    variant === 'primary'
      ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent shadow-xl shadow-[var(--accent)]/20 enabled:hover:scale-[1.02] active:scale-[0.98]'
      : variant === 'ghost'
        ? cx('bg-transparent border-transparent shadow-none', colors.text)
        : cx(colors.softBg, colors.softBorder, colors.text, `shadow-lg ${colors.glow}`);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'ds-action-button',
        variantClass,
        className
      )}
    >
      {children}
    </button>
  );
};
