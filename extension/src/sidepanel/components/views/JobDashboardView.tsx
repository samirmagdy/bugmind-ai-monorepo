import React, { useEffect, useState, useCallback } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { Activity, Clock, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';
import { apiRequest, readJsonResponse, throwApiErrorResponse } from '../../services/api';

export interface Job {
  id: string;
  job_type: string;
  status: string;
  target_key: string;
  progress_percentage: number;
  current_step: string | null;
  created_at: string;
  error_message: string | null;
  result_payload: Record<string, unknown> | null;
}

export const JobDashboardView: React.FC = () => {
  const { updateSession, auth: { apiBase, authToken, refreshSession } } = useBugMind();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await apiRequest(`${apiBase}/jobs`, {
        token: authToken,
        onUnauthorized: refreshSession,
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to fetch background jobs');
      if (res.ok) {
        const data = await readJsonResponse<Job[]>(res);
        setJobs(data);
      }
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken, refreshSession]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const cancelJob = async (jobId: string) => {
    const res = await apiRequest(`${apiBase}/jobs/${jobId}/cancel`, {
      method: 'POST',
      token: authToken,
      onUnauthorized: refreshSession,
    });
    if (!res.ok) await throwApiErrorResponse(res, 'Failed to cancel job');
    fetchJobs();
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border-main)]">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-[var(--primary-blue)]" />
          <h2 className="text-sm font-bold text-[var(--text-main)]">Background Jobs</h2>
        </div>
        <button
          onClick={() => updateSession({ view: 'main' })}
          className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          Back to Home
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-[var(--text-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center p-8 bg-[var(--bg-input)] rounded-xl border border-[var(--border-main)] text-[var(--text-muted)] text-xs">
          No background jobs running or completed.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map(job => (
            <SurfaceCard key={job.id} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono bg-[var(--surface-soft)] px-1.5 py-0.5 rounded text-[var(--text-secondary)] border border-[var(--border-soft)]">
                    {job.target_key}
                  </span>
                  <span className="text-xs font-semibold capitalize text-[var(--text-main)]">
                    {job.job_type.replace(/_/g, ' ')}
                  </span>
                </div>
                
                {job.status === 'running' && (
                  <div className="flex items-center gap-1.5 text-[var(--primary-blue)] text-[10px] font-bold uppercase tracking-wider">
                    <Loader2 size={12} className="animate-spin" /> Running
                  </div>
                )}
                {job.status === 'completed' && (
                  <div className="flex items-center gap-1.5 text-[var(--success)] text-[10px] font-bold uppercase tracking-wider">
                    <CheckCircle2 size={12} /> Completed
                  </div>
                )}
                {job.status === 'failed' && (
                  <div className="flex items-center gap-1.5 text-[var(--error)] text-[10px] font-bold uppercase tracking-wider">
                    <AlertTriangle size={12} /> Failed
                  </div>
                )}
                {job.status === 'cancelled' && (
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)] text-[10px] font-bold uppercase tracking-wider">
                    <X size={12} /> Cancelled
                  </div>
                )}
                {job.status === 'queued' && (
                  <div className="flex items-center gap-1.5 text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider">
                    <Clock size={12} /> Queued
                  </div>
                )}
              </div>

              {job.status === 'running' || job.status === 'partial_result_ready' ? (
                <div className="space-y-1.5 mt-3">
                  <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                    <span className="truncate">{job.current_step || 'Processing...'}</span>
                    <span>{Math.round(job.progress_percentage)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--bg-input)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${job.progress_percentage}%` }}
                    />
                  </div>
                </div>
              ) : null}
              
              {job.error_message && (
                <div className="mt-2 text-[10px] text-[var(--error)] bg-[var(--error)]/10 p-2 rounded border border-[var(--error)]/20">
                  {job.error_message}
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border-soft)] pt-2">
                {(job.status === 'running' || job.status === 'queued' || job.status === 'partial_result_ready') && (
                  <button 
                    onClick={() => cancelJob(job.id)}
                    className="text-[10px] font-bold text-[var(--error)] uppercase hover:bg-[var(--error)]/10 px-2 py-1 rounded transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {job.status === 'completed' && job.result_payload && (
                  <ActionButton 
                    variant="primary" 
                    className="h-6 px-2 text-[10px]"
                    onClick={() => {
                      updateSession({ view: 'success', success: `Job generated results successfully!` });
                      // Add logic to display results
                    }}
                  >
                    View Results
                  </ActionButton>
                )}
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
};
