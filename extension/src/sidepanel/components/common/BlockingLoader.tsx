import React from 'react';
import { Loader2, Zap } from 'lucide-react';

interface BlockingLoaderProps {
  message?: string;
}

const BlockingLoader: React.FC<BlockingLoaderProps> = ({ message = "Synthesizing requirements..." }) => {
  return (
    <div className="fixed inset-0 z-[1000] bg-[var(--bg-overlay)] backdrop-blur-[12px] flex flex-col items-center justify-center animate-bp-flicker">
      {/* Background Decorative Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40%] h-[40%] bg-[var(--status-info)]/10 blur-[120px] rounded-full animate-pulse-slow"></div>

      <div className="relative group mb-10">
        <div className="absolute inset-0 blur-3xl rounded-full animate-pulse bg-[var(--status-info)]/30 group-hover:bg-[var(--status-info)]/40 transition-all duration-1000"></div>
        <div className="relative z-10 bp-panel p-10 rounded-[3rem] border border-[var(--border-main)] shadow-2xl animate-bp-flicker">
          <Loader2 className="w-16 h-16 text-[var(--status-info)] animate-spin-slow" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <Zap size={24} className="text-[var(--status-info)] animate-pulse" fill="currentColor" />
          </div>
        </div>
      </div>
      
      <div className="text-center space-y-6 px-12 max-w-sm animate-bp-flicker stagger-1">
        <div className="space-y-2">
          <h3 className="text-lg font-black text-[var(--text-main)] tracking-tight leading-tight">{message}</h3>
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-6 bg-gradient-to-r from-transparent to-[var(--border-main)]"></div>
            <p className="bp-subheading text-[10px] opacity-40 lowercase font-bold tracking-tight italic">BugMind Engine Active</p>
            <div className="h-px w-6 bg-gradient-to-l from-transparent to-[var(--border-main)]"></div>
          </div>
        </div>

        {/* Premium Progress Track */}
        <div className="h-1.5 w-48 mx-auto rounded-full overflow-hidden bg-[var(--bg-input)] border border-[var(--border-main)] relative">
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--status-info)] via-[var(--accent-hover)] to-[var(--status-info)] animate-progress origin-left shadow-[0_0_10px_var(--status-info)]"></div>
        </div>
      </div>
    </div>
  );
};

export default BlockingLoader;
