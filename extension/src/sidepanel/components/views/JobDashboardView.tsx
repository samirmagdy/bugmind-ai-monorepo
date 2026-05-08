import React, { useEffect, useState, useCallback } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { Activity, Clock, CheckCircle2, AlertTriangle, Loader2, X, Copy, RefreshCw } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';
import { apiRequest, readJsonResponse, throwApiErrorResponse } from '../../services/api';
import { addActivity } from '../../utils/productivity';

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
  retry_of_job_id?: string | null;
  resume_of_job_id?: string | null;
  retry_count?: number;
}

export const JobDashboardView: React.FC = () => {
  const { session, updateSession, auth: { apiBase, authToken, refreshSession } } = useBugMind();
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

  const restartJob = async (job: Job, mode: 'retry' | 'resume') => {
    try {
      setLoading(true);
      const res = await apiRequest(`${apiBase}/jobs/${job.id}/${mode}`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshSession,
      });
      if (!res.ok) await throwApiErrorResponse(res, `Failed to ${mode} job`);
      const nextJob = await readJsonResponse<Job>(res);
      updateSession({
        success: mode === 'retry' ? 'Job retry started.' : 'Job resume started.',
        activityFeed: addActivity(session, {
          kind: 'job',
          title: mode === 'retry' ? 'Retried background job' : 'Resumed background job',
          detail: `${job.target_key} -> ${nextJob.id.slice(0, 8)}`,
          actionView: 'jobs'
        })
      });
      fetchJobs();
    } catch (err) {
      updateSession({ error: err instanceof Error ? err.message : `Failed to ${mode} job` });
    } finally {
      setLoading(false);
    }
  };

  const copyJobError = async (job: Job) => {
    await navigator.clipboard.writeText(job.error_message || JSON.stringify(job, null, 2));
    updateSession({
      success: 'Job error copied.',
      activityFeed: addActivity(session, {
        kind: 'job',
        title: 'Copied job diagnostics',
        detail: `${job.target_key} ${job.job_type}`,
        actionView: 'jobs'
      })
    });
  };

  const viewJobResult = (job: Job) => {
    updateSession({
      view: 'success',
      success: `${job.target_key} job completed successfully.`,
      activityFeed: addActivity(session, {
        kind: 'job',
        title: 'Opened job result',
        detail: `${job.target_key} ${job.job_type.replace(/_/g, ' ')}`,
        actionView: 'success'
      })
    });
  };

  return (
    <div className="view-shell animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SurfaceCard className="view-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]">
            <Activity size={18} />
          </div>
          <div className="view-heading">
            <p className="view-kicker">Activity</p>
            <h2 className="view-title">Background Jobs</h2>
            <p className="view-subtitle">Live status for generation and publishing tasks.</p>
          </div>
        </div>
        <button
          onClick={() => { setLoading(true); fetchJobs(); }}
          className="rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text-main)]"
          aria-label="Refresh jobs"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </SurfaceCard>

      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-[var(--text-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center p-8 bg-[var(--bg-input)] rounded-[8px] border border-[var(--border-main)] text-[var(--text-muted)] text-xs">
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
                <button
                  onClick={() => updateSession({ view: 'main' })}
                  className="text-[10px] font-bold text-[var(--text-muted)] uppercase hover:bg-[var(--surface-soft)] px-2 py-1 rounded transition-colors"
                >
                  Resume Work
                </button>
                {(job.status === 'running' || job.status === 'queued' || job.status === 'partial_result_ready') && (
                  <button 
                    onClick={() => cancelJob(job.id)}
                    className="text-[10px] font-bold text-[var(--error)] uppercase hover:bg-[var(--error)]/10 px-2 py-1 rounded transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {job.error_message && (
                  <button
                    onClick={() => copyJobError(job)}
                    className="flex items-center gap-1 text-[10px] font-bold text-[var(--text-muted)] uppercase hover:bg-[var(--surface-soft)] px-2 py-1 rounded transition-colors"
                  >
                    <Copy size={11} />
                    Copy Error
                  </button>
                )}
                {(job.status === 'failed' || job.status === 'cancelled') && (
                  <button
                    onClick={() => restartJob(job, 'retry')}
                    className="flex items-center gap-1 text-[10px] font-bold text-[var(--primary-blue)] uppercase hover:bg-[var(--surface-soft)] px-2 py-1 rounded transition-colors"
                  >
                    <RefreshCw size={11} />
                    Retry Job
                  </button>
                )}
                {job.status === 'partial_result_ready' && (
                  <button
                    onClick={() => restartJob(job, 'resume')}
                    className="flex items-center gap-1 text-[10px] font-bold text-[var(--primary-blue)] uppercase hover:bg-[var(--surface-soft)] px-2 py-1 rounded transition-colors"
                  >
                    <RefreshCw size={11} />
                    Resume Job
                  </button>
                )}
                {job.status === 'completed' && job.result_payload && (
                  <ActionButton 
                    variant="primary" 
                    className="h-6 px-2 text-[10px]"
                    onClick={() => viewJobResult(job)}
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
