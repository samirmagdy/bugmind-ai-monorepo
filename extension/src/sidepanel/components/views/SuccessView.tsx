import React from 'react';
import { CheckCircle, ExternalLink } from 'lucide-react';
import { useBugMind } from '../../context/BugMindContext';

const SuccessView: React.FC = () => {
  const { session, updateSession } = useBugMind();

  return (
    <div className="py-12 text-center space-y-6 animate-in zoom-in-95 duration-500">
      <div className="w-24 h-24 bg-[var(--status-success)]/20 rounded-full flex items-center justify-center mx-auto border border-[var(--status-success)]/30 text-[var(--status-success)]">
        <CheckCircle size={56} />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-[var(--text-main)]">Project Updated!</h2>
          <p className="text-sm text-[var(--text-muted)] px-6">Your findings have been successfully logged as bug tickets in Jira.</p>
        </div>

        {session.createdIssues && session.createdIssues.length > 0 && (
          <div className="space-y-2 px-6 max-h-[220px] overflow-y-auto custom-scrollbar">
            {session.createdIssues.map((issue: any) => (
              <a 
                key={issue.key}
                href={`${session.instanceUrl}/browse/${issue.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-[var(--bg-card)] border border-[var(--border-main)] p-3.5 rounded-2xl hover:bg-[var(--bg-app)] shadow-[var(--shadow-sm)] transition-all group"
              >
                <div className="flex flex-col items-start gap-1">
                  <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">Issue Created</span>
                  <span className="text-xs font-bold text-[var(--text-main)]">{issue.key}</span>
                </div>
                <div className="p-2 bg-[var(--status-info)]/10 rounded-xl text-[var(--status-info)] opacity-0 group-hover:opacity-100 transition-all">
                  <ExternalLink size={14} />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
      <button 
        onClick={() => { updateSession({ bugs: [], view: 'main' }); }}
        className="w-full bg-[var(--bg-card)] hover:bg-[var(--bg-app)] border border-[var(--border-main)] text-[var(--text-main)] font-bold py-4 rounded-2xl shadow-[var(--shadow-sm)] transition-all flex items-center justify-center gap-2 btn-press"
      >
        Find Next Issue
      </button>
    </div>
  );
};

export default SuccessView;
