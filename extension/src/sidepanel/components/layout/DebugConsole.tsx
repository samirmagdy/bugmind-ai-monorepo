import React from 'react';
import { Plus } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { ActionButton, StatusBadge, SurfaceCard } from '../common/DesignSystem';

const DebugConsole: React.FC = () => {
  const { debug: { show: showDebug, setShow: setShowDebug, logs: debugLogs, clear: clearLogs } } = useBugMind();

  if (!showDebug) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-1/2 bg-[var(--bg-app)] border-t border-[var(--status-info)]/30 z-[200] flex flex-col animate-in slide-in-from-bottom-full duration-300 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
      <div className="flex justify-between items-center px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border-main)]">
        <StatusBadge tone="info" className="border-none bg-transparent px-0 py-0">Detailed Debugger</StatusBadge>
        <div className="flex items-center gap-3">
          <ActionButton
            onClick={() => { navigator.clipboard.writeText(JSON.stringify(debugLogs, null, 2)) }}
            variant="ghost"
            tone="neutral"
            className="w-auto px-0 py-0 text-[10px] normal-case tracking-normal font-bold"
          >
            Copy Logs
          </ActionButton>
          <div className="w-[1px] h-3 bg-[var(--border-main)]" />
          <ActionButton
            onClick={clearLogs}
            variant="ghost"
            tone="danger"
            className="w-auto px-0 py-0 text-[10px] normal-case tracking-normal font-bold"
          >
            Clear
          </ActionButton>
          <div className="w-[1px] h-3 bg-[var(--border-main)]" />
          <button onClick={() => setShowDebug(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1">
            <Plus className="rotate-45" size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-2 selection:bg-[var(--status-info)]/30 custom-scrollbar">
        {debugLogs.length === 0 ? (
          <div className="text-[var(--text-muted)] opacity-50 italic">No logs yet. Trigger an action to see telemetry...</div>
        ) : (
          debugLogs.map((log, i) => (
            <SurfaceCard key={i} className="border-l-2 rounded-none border-y-0 border-r-0 border-l-[var(--border-main)] bg-transparent px-2 py-1 hover:bg-[var(--text-main)]/[0.02] shadow-none">
              <span className="text-[var(--text-muted)] opacity-60">[{log.timestamp}]</span>{' '}
              <span className={`font-bold ${
                log.tag.includes('ERROR') || log.tag.includes('FAIL') || log.tag.includes('CRASH') ? 'text-[var(--status-danger)]' : 
                log.tag.includes('OK') || log.tag.includes('SUCCESS') ? 'text-[var(--status-success)]' : 'text-[var(--status-info)]'
              }`}>
                {log.tag}
              </span>{' '}
              <span className="text-[var(--text-main)]">{log.msg}</span>
            </SurfaceCard>
          ))
        )}
      </div>
    </div>
  );
};

export default DebugConsole;
