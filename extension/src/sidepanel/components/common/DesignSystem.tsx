import React from 'react';
import { LucideIcon } from 'lucide-react';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function toneClasses(tone: Tone): { text: string; chip: string } {
  switch (tone) {
    case 'success':
      return {
        text: 'text-[var(--success)]',
        chip: 'chip-valid'
      };
    case 'warning':
      return {
        text: 'text-[#B45309]',
        chip: 'chip-warning'
      };
    case 'danger':
      return {
        text: 'text-[var(--error)]',
        chip: 'chip-error'
      };
    case 'neutral':
      return {
        text: 'text-[var(--text-primary)]',
        chip: ''
      };
    case 'info':
    default:
      return {
        text: 'text-[var(--primary-blue)]',
        chip: ''
      };
  }
}

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}> = ({ children, className, onClick }) => (
  <div className={cx('workflow-card', className)} onClick={onClick}>
    {children}
  </div>
);

export const SectionTitle: React.FC<{
  title: string;
  subtitle?: string;
  className?: string;
}> = ({ title, subtitle, className }) => (
  <div className={cx('space-y-1', className)}>
    <h2 className="workflow-card-title">{title}</h2>
    {subtitle ? (
      <p className="workflow-card-subtitle">{subtitle}</p>
    ) : null}
  </div>
);

export const FieldLabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <label className={cx('context-label font-semibold mb-1.5 block ml-0.5', className)}>{children}</label>
);

export const StatusBadge: React.FC<{
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}> = ({ children, tone = 'info', className }) => {
  const colors = toneClasses(tone);
  return (
    <span className={cx(
      'chip',
      colors.chip || 'bg-[var(--surface-soft)] text-[var(--text-secondary)]',
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
  
  if (tone === 'warning') {
    return (
      <div className={cx('warning-card', className)}>
        <div className="flex gap-3">
          {Icon && <Icon size={18} className="shrink-0 mt-0.5" />}
          <div>
            <p className="font-bold text-sm">{title}</p>
            {description && <div className="text-xs mt-1 opacity-90">{description}</div>}
            {children && <div className="mt-3">{children}</div>}
            {action && <div className="mt-3">{action}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (tone === 'danger') {
    return (
      <div className={cx('error-card', className)}>
        <div className="flex gap-3">
          {Icon && <Icon size={18} className="shrink-0 mt-0.5" />}
          <div>
            <p className="font-bold text-sm">{title}</p>
            {description && <div className="text-xs mt-1 opacity-90">{description}</div>}
            {children && <div className="mt-3">{children}</div>}
            {action && <div className="mt-3">{action}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('empty-state-card', className)}>
      <div className="flex flex-col items-center">
        {Icon && (
          <div className="empty-icon">
            <Icon size={32} />
          </div>
        )}
        <p className="empty-title">{title}</p>
        {description && (
          <div className="empty-description mt-2">
            {description}
          </div>
        )}
        {children && <div className="mt-4 w-full">{children}</div>}
        {action && <div className="mt-6 w-full">{action}</div>}
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
}> = ({ children, onClick, type = 'button', disabled, variant = 'secondary', className }) => {
  const variantClass =
    variant === 'primary' ? 'btn-primary' :
    variant === 'ghost' ? 'btn-ghost' :
    'btn-secondary';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        variantClass,
        className
      )}
    >
      {children}
    </button>
  );
};
