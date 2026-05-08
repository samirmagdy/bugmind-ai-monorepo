import React, { useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { X, Cloud, Key, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';
import { apiRequest, getErrorMessage, readJsonResponse, throwApiErrorResponse } from '../../services/api';

export const XrayCloudWizard: React.FC = () => {
  const { session, updateSession, jira, auth: { apiBase, authToken, refreshSession } } = useBugMind();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTest = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setErrorMsg('Please enter both Client ID and Client Secret.');
      return;
    }
    setErrorMsg('');
    setIsTesting(true);
    setTestSuccess(null);

    try {
      // First, update the connection with the new credentials so they can be tested
      const saved = await jira.updateConnection(session.jiraConnectionId!, {
        xray_cloud_client_id: clientId.trim(),
        xray_cloud_client_secret: clientSecret.trim()
      });

      if (!saved) {
        throw new Error("Failed to save credentials for testing.");
      }

      // Now call the test endpoint
      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/xray/test-connection`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        token: authToken,
        onUnauthorized: refreshSession,
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, "Failed to authenticate with Xray Cloud.");
      }
      await readJsonResponse<unknown>(res);

      setTestSuccess(true);
      await jira.fetchConnections(); // refresh connections
    } catch (err: unknown) {
      setTestSuccess(false);
      setErrorMsg(getErrorMessage(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!testSuccess) {
      setErrorMsg('Please test the connection successfully before saving.');
      return;
    }
    setIsSaving(true);
    try {
      await jira.fetchConnections(); // ensure connections are refreshed
      
      if (session.xrayCloudWizardMode === 'publish') {
        updateSession({ showXrayCloudWizard: false, xrayCloudWizardMode: undefined });
        // The user can now click publish again
      } else {
        updateSession({ showXrayCloudWizard: false, xrayCloudWizardMode: undefined });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-[12px] p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="xray-cloud-title">
      <div className="w-full max-w-sm max-h-full overflow-y-auto">
        <SurfaceCard className="relative overflow-hidden flex flex-col pointer-events-auto">
          <div className="flex items-center justify-between p-4 border-b border-[var(--border-main)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[8px] bg-[var(--surface-accent-strong)] flex items-center justify-center text-[var(--primary-blue)] border border-[var(--border-soft)]">
                <Cloud size={16} />
              </div>
              <div>
                <h3 id="xray-cloud-title" className="text-sm font-bold text-[var(--text-main)] leading-tight">Xray Cloud Setup</h3>
                <p className="view-kicker mt-0.5">Configure API Credentials</p>
              </div>
            </div>
            <button
              onClick={() => updateSession({ showXrayCloudWizard: false, xrayCloudWizardMode: undefined })}
              className="icon-button"
              aria-label="Close Xray Cloud setup"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              To publish tests directly to Xray Cloud, please provide your API Key credentials. These will be encrypted and stored securely.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="xray-client-id" className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Client ID</label>
                <input
                  id="xray-client-id"
                  type="text"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setTestSuccess(null);
                  }}
                  className="form-input px-3 py-2 text-xs font-mono"
                  placeholder="e.g. 12345678ABCD..."
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="xray-client-secret" className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 flex items-center gap-1.5">
                  <Key size={10} /> Client Secret
                </label>
                <input
                  id="xray-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => {
                    setClientSecret(e.target.value);
                    setTestSuccess(null);
                  }}
                  className="form-input px-3 py-2 text-xs font-mono"
                  placeholder="••••••••••••••••"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-[var(--error-bg)] border border-[var(--error)]/20 rounded-[8px] text-[var(--error)] text-xs" role="alert">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            
            {testSuccess && (
              <div className="flex items-center gap-2 p-3 bg-[var(--success-bg)] border border-[var(--success)]/20 rounded-[8px] text-[var(--success)] text-xs font-medium" role="status">
                <CheckCircle size={14} />
                Connection verified successfully.
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[var(--border-main)] bg-[var(--bg-input)] flex justify-between gap-3">
            <ActionButton
              onClick={handleTest}
              disabled={isTesting || isSaving || !clientId || !clientSecret}
              variant="secondary"
              className="flex-1"
            >
              {isTesting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              {isTesting ? 'Testing...' : 'Test Connection'}
            </ActionButton>
            
            <ActionButton
              onClick={handleSave}
              disabled={!testSuccess || isSaving}
              variant="primary"
              className="flex-1"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              {session.xrayCloudWizardMode === 'publish' ? 'Save & Continue' : 'Save Credentials'}
            </ActionButton>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
