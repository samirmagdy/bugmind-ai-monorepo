import React from 'react';
import { Loader2 } from 'lucide-react';

interface BlockingLoaderProps {
  message?: string;
}

const BlockingLoader: React.FC<BlockingLoaderProps> = ({ message = "Analyzing and structuring report..." }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-overlay)] backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-[var(--status-info)]/30 blur-3xl rounded-full animate-pulse" />
        <Loader2 className="w-12 h-12 text-[var(--status-info)] animate-spin relative z-10" />
      </div>
      
      <div className="text-center space-y-2 px-8">
        <h3 className="text-lg font-bold text-[var(--text-main)] tracking-tight">{message}</h3>
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-[0.2em] font-black opacity-60">BugMind AI Engine at work</p>
      </div>

      <div className="mt-12 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div 
            key={i} 
            className="w-1.5 h-1.5 bg-[var(--status-info)]/50 rounded-full animate-bounce" 
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
};

export default BlockingLoader;
