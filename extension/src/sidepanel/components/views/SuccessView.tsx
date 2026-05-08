import React from 'react';
import { CheckCircle, ExternalLink } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { ActionButton, StatusBadge, SurfaceCard } from '../common/DesignSystem';

const SuccessView: React.FC = () => {
  const { session, updateSession } = useBugMind();

  return (
    <div className="py-8 text-center space-y-5 animate-in zoom-in-95 duration-500">
      <div className="w-16 h-16 bg-[var(--status-success)]/14 rounded-[8px] flex items-center justify-center mx-auto border border-[var(--status-success)]/20 text-[var(--status-success)] shadow-[var(--shadow-sm)]">
        <CheckCircle size={38} />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="view-kicker">Published</p>
          <h2 className="text-lg font-bold text-[var(--text-main)]">Project Updated</h2>
          <p className="text-xs text-[var(--text-muted)] px-6">Your findings have been logged as Jira tickets.</p>
        </div>

        {session.createdIssues && session.createdIssues.length > 0 && (
          <div className="space-y-2 px-6">
            {session.createdIssues.map((issue) => (
              <SurfaceCard
                key={issue.key}
                className="group p-0 hover:bg-[var(--bg-app)]/70"
              >
                <a 
                  href={`${session.instanceUrl}/browse/${issue.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3.5"
                >
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge className="px-0 py-0 border-none bg-transparent shadow-none" tone={issue.linkedToStory === false ? 'warning' : 'info'}>
                      {issue.linkedToStory === false ? 'Created Only' : 'Created & Linked'}
                    </StatusBadge>
                    <span className="text-xs font-bold text-[var(--text-main)]">{issue.key}</span>
                  </div>
                  <div className="p-2 bg-[var(--status-info)]/10 rounded-[8px] text-[var(--status-info)] opacity-0 group-hover:opacity-100 transition-all">
                    <ExternalLink size={14} />
                  </div>
                </a>
              </SurfaceCard>
            ))}
          </div>
        )}
      </div>
      <ActionButton
        onClick={() => {
          updateSession({
            bugs: [],
            testCases: [],
            coverageScore: null,
            gapAnalysisSummary: null,
            createdIssues: [],
            xrayWarnings: [],
            view: 'main',
            mainWorkflow: 'home',
            previewBugIndex: null,
            resolvedPayload: null,
            validationErrors: [],
            expandedBug: null,
            error: null,
            success: null
          });
        }}
        variant="secondary"
        tone="neutral"
        className="py-4 rounded-[8px] font-bold"
      >
        Find Next Issue
      </ActionButton>
    </div>
  );
};

export default SuccessView;
