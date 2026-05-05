import React, { useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { X, Cloud, Key, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';

export const XrayCloudWizard: React.FC = () => {
  const { session, updateSession, jira, auth: { apiBase, authToken } } = useBugMind();
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
      const res = await fetch(`${apiBase}/jira/connections/${session.jiraConnectionId}/xray/test-connection`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Accept': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || "Failed to authenticate with Xray Cloud.");
      }

      setTestSuccess(true);
      await jira.fetchConnections(); // refresh connections
    } catch (err: unknown) {
      setTestSuccess(false);
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm max-h-full overflow-y-auto">
        <SurfaceCard className="relative overflow-hidden flex flex-col pointer-events-auto shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
          
          <div className="flex items-center justify-between p-4 border-b border-[var(--border-main)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                <Cloud size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] leading-tight">Xray Cloud Setup</h3>
                <p className="text-[10px] text-[var(--text-muted)] font-medium">Configure API Credentials</p>
              </div>
            </div>
            <button
              onClick={() => updateSession({ showXrayCloudWizard: false, xrayCloudWizardMode: undefined })}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-input)] rounded-lg transition-colors"
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
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setTestSuccess(null);
                  }}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500/30 focus:ring-4 focus:ring-blue-500/10 transition-all font-mono"
                  placeholder="e.g. 12345678ABCD..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 flex items-center gap-1.5">
                  <Key size={10} /> Client Secret
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => {
                    setClientSecret(e.target.value);
                    setTestSuccess(null);
                  }}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500/30 focus:ring-4 focus:ring-blue-500/10 transition-all font-mono"
                  placeholder="••••••••••••••••"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            
            {testSuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500 text-xs font-medium">
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
