import React from 'react';
import { Loader2, Zap } from 'lucide-react';
import { SurfaceCard } from './DesignSystem';
import { useI18n } from '../../i18n';

interface BlockingLoaderProps {
  message?: string;
  percent?: number;
  etaSeconds?: number | null;
}

const BlockingLoader: React.FC<BlockingLoaderProps> = ({ message, percent = 0, etaSeconds = null }) => {
  const { t } = useI18n();
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div className="fixed inset-0 z-[1000] bg-[var(--bg-overlay)] backdrop-blur-[12px] flex flex-col items-center justify-center">
      <div className="relative group mb-8">
        <SurfaceCard className="relative z-10 p-8 rounded-[8px] border border-[var(--card-border)] shadow-[var(--shadow-card)]">
          <Loader2 className="w-14 h-14 text-[var(--status-info)] animate-spin" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <Zap size={20} className="text-[var(--status-info)] animate-pulse" fill="currentColor" />
          </div>
        </SurfaceCard>
      </div>
      
      <div className="text-center space-y-5 px-8 max-w-sm">
        <div className="space-y-2">
          <h3 className="text-lg font-black text-[var(--text-main)] tracking-tight leading-tight">{message || t('loader.default')}</h3>
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-6 bg-gradient-to-r from-transparent to-[var(--border-main)]"></div>
            <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-[var(--text-muted)] opacity-80">
              {etaSeconds ? t('loader.eta', { seconds: etaSeconds }) : t('loader.engine')}
            </p>
            <div className="h-px w-6 bg-gradient-to-l from-transparent to-[var(--border-main)]"></div>
          </div>
        </div>

        {/* Premium Progress Track */}
        <div className="h-1.5 w-48 mx-auto rounded-full overflow-hidden bg-[var(--bg-input)] border border-[var(--border-main)] relative">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--status-info)] transition-all duration-500"
            style={{ width: `${safePercent || 18}%` }}
          />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">{safePercent}%</p>
      </div>
    </div>
  );
};

export default BlockingLoader;
