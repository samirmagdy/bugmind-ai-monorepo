import React from 'react';
import { Plus } from 'lucide-react';
import { useBugMind } from '../../context/BugMindContext';

const DebugConsole: React.FC = () => {
  const { debug: { show: showDebug, setShow: setShowDebug, logs: debugLogs, clear: clearLogs } } = useBugMind();

  if (!showDebug) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-1/2 bg-[var(--bg-app)] border-t border-[var(--status-info)]/30 z-[200] flex flex-col animate-in slide-in-from-bottom-full duration-300 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
      <div className="flex justify-between items-center px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border-main)]">
        <h3 className="text-[11px] font-bold text-[var(--status-info)] uppercase tracking-widest">Detailed Debugger</h3>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => { navigator.clipboard.writeText(JSON.stringify(debugLogs, null, 2)) }}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            Copy Logs
          </button>
          <div className="w-[1px] h-3 bg-[var(--border-main)]" />
          <button 
            onClick={clearLogs}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-colors"
          >
            Clear
          </button>
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
            <div key={i} className="border-l-2 border-[var(--border-main)] pl-2 py-1 hover:bg-[var(--text-main)]/[0.02]">
              <span className="text-[var(--text-muted)] opacity-60">[{log.timestamp}]</span>{' '}
              <span className={`font-bold ${
                log.tag.includes('ERROR') || log.tag.includes('FAIL') || log.tag.includes('CRASH') ? 'text-[var(--status-danger)]' : 
                log.tag.includes('OK') || log.tag.includes('SUCCESS') ? 'text-[var(--status-success)]' : 'text-[var(--status-info)]'
              }`}>
                {log.tag}
              </span>{' '}
              <span className="text-[var(--text-main)]">{log.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DebugConsole;
