import { X, ChevronDown, Loader2 } from 'lucide-react';
import { useBugMind } from '../../context/BugMindContext';
import { IssueType, JiraField } from '../../types';

const SettingsView: React.FC = () => {
  const { 
    session, updateSession, handleSaveSettings, saveFieldSettings, auth: { setGlobalView },
    ai: { customKey, setCustomKey, hasCustomKeySaved, customModel, setCustomModel },
    jira: { verifySsl, setVerifySsl },
    auth: { apiBase, setApiBase }
  } = useBugMind();

  return (
    <div className="space-y-6 pt-4 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => updateSession({ view: 'main' })} className="p-2 hover:bg-[var(--bg-card)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all">
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold text-[var(--text-main)] leading-none">Settings</h2>
      </div>
      
      <div className="flex bg-[var(--bg-input)] p-1 rounded-xl border border-[var(--border-main)] mb-6 shadow-[var(--shadow-sm)]">
        <button 
          onClick={() => updateSession({ settingsTab: 'ai' })}
          className={`flex-1 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${session.settingsTab === 'ai' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
        >
          AI Configuration
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'jira' })}
          className={`flex-1 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${session.settingsTab === 'jira' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
        >
          Bug Field Mapping
        </button>
      </div>

      {session.settingsTab === 'ai' ? (
        <>
          <div className="bg-[var(--bg-card)] border border-[var(--border-main)] p-4 rounded-xl space-y-3 mb-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
              <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">Platform Settings</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">BugMind API Endpoint</label>
              <input 
                type="url" 
                value={apiBase} 
                onChange={e => {
                  const val = e.target.value;
                  setApiBase(val);
                  chrome.storage.local.set({ 'bugmind_api_base': val });
                }}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50"
                placeholder="https://api.bugmind.ai/api"
              />
            </div>
          </div>
          <div className="bg-[var(--status-info)]/5 border border-[var(--status-info)]/10 p-4 rounded-xl space-y-2 mb-6 shadow-inner">
            <p className="text-[11px] text-[var(--status-info)] uppercase font-bold tracking-wider">Experimental Feature</p>
            <p className="text-xs text-[var(--text-muted)] leading-normal">
              Override the default BugMind AI configuration with your own OpenRouter credentials. Leave fields empty to use the system default.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">OpenRouter API Key</label>
              <input 
                type="password" 
                value={customKey} 
                onChange={e => setCustomKey(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm text-[var(--text-main)]"
                placeholder={hasCustomKeySaved ? "••••••••••••••••" : "sk-or-v1-..."}
              />
              {hasCustomKeySaved && <p className="text-[10px] text-[var(--status-success)] ml-1">✓ Custom key currently active</p>}
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">AI Model ID</label>
              <input 
                type="text" 
                value={customModel} 
                onChange={e => setCustomModel(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm text-[var(--text-main)]"
                placeholder="e.g. anthropic/claude-3-sonnet"
              />
              <p className="text-[10px] text-[var(--text-muted)] ml-1 opacity-70">Format: vendor/model-name</p>
            </div>

            <div className="pt-4 space-y-3">
              <button type="submit" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-[var(--accent)]/20">
                Apply Custom Settings
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-[var(--status-success)]/5 border border-[var(--status-success)]/10 p-4 rounded-xl space-y-2 mb-2 shadow-inner">
            <p className="text-[11px] text-[var(--status-success)] uppercase font-bold tracking-wider">Project Configuration</p>
            <p className="text-xs text-[var(--text-muted)] leading-normal">
              Configuration for project <strong>{session.issueData?.key.split('-')[0]}</strong>. Settings are saved per issue type.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Select Issue Type</label>
              <div className="relative">
                <select 
                  value={session.selectedIssueType?.id || ''}
                  onChange={(e) => {
                    const type = session.issueTypes.find((t: IssueType) => t.id === e.target.value);
                    if (type) updateSession({ selectedIssueType: type });
                  }}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm appearance-none cursor-pointer pr-10 text-[var(--text-main)] shadow-[var(--shadow-sm)]"
                >
                  {session.issueTypes.map((type: IssueType) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={16} />
              </div>
            </div>

            {!session.jiraMetadata ? (
              session.error?.includes('Jira fields') || session.error?.includes('issue types') ? (
                <div className="py-8 px-4 text-center bg-[var(--status-danger)]/5 border border-[var(--status-danger)]/20 rounded-2xl space-y-4 animate-in fade-in duration-300">
                  <div className="text-[var(--status-danger)] text-xs font-bold uppercase tracking-tight">Configuration Error</div>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-4">{session.error}</p>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.instanceUrl && session.issueData) {
                        updateSession({ error: null });
                        if (session.issueTypes.length === 0) {
                          useBugMind().jira.fetchIssueTypes(pKey, session.instanceUrl, undefined, session.issueData.projectId);
                        } else if (session.selectedIssueType) {
                          useBugMind().jira.fetchJiraMetadata(pKey, session.instanceUrl, session.selectedIssueType.id, undefined, session.issueData.projectId);
                        }
                      }
                    }}
                    className="w-full bg-[var(--status-danger)]/10 hover:bg-[var(--status-danger)]/20 border border-[var(--status-danger)]/30 text-[var(--status-danger)] text-[10px] font-black py-3 rounded-xl transition-all uppercase tracking-widest"
                  >
                    Retry Fetch
                  </button>
                </div>
              ) : (
                <div className="py-12 text-center text-[var(--text-muted)] flex flex-col items-center gap-3">
                  <div className="relative">
                    <Loader2 className="animate-spin text-[var(--status-info)]/30" size={32} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-1.5 w-1.5 bg-[var(--status-info)] rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] opacity-60">Fetching Remote Schema...</div>
                </div>
              )
            ) : (
              <div className="space-y-6">
                {/* AI Property Mapping Section */}
                <div className="bg-[var(--status-info)]/5 border border-[var(--status-info)]/10 p-4 rounded-xl space-y-4 shadow-inner">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
                    <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">AI Property Mapping</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] opacity-80 leading-normal uppercase font-bold tracking-tight">
                    Route AI data to specific custom fields
                  </p>
                  
                  {[
                    { id: 'steps_to_reproduce', label: 'Steps to Reproduce' },
                    { id: 'expected_result', label: 'Expected Result' },
                    { id: 'actual_result', label: 'Actual Result' }
                  ].map(prop => (
                    <div key={prop.id} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">{prop.label}</label>
                      <div className="relative">
                        <select 
                          value={(session.aiMapping?.[prop.id]) || 'description'}
                          onChange={(e) => {
                            const nextMapping = { ...(session.aiMapping || {}), [prop.id]: e.target.value };
                            saveFieldSettings(undefined, nextMapping);
                          }}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2.5 outline-none focus:border-[var(--status-info)]/50 transition-all text-xs appearance-none cursor-pointer pr-10 text-[var(--text-main)] shadow-inner"
                        >
                          <option value="description">Description (Default)</option>
                          {session.jiraMetadata?.fields.map((f: JiraField) => (
                            <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none opacity-60" size={14} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Visible Fields Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Available Fields</label>
                    <span className="text-[10px] text-[var(--status-info)] font-bold bg-[var(--status-info)]/10 px-2 py-0.5 rounded-full shadow-sm">{session.jiraMetadata.fields.length} Found</span>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                    {session.jiraMetadata.fields.length === 0 ? (
                      <div className="py-8 text-center bg-[var(--bg-input)] rounded-xl border border-dashed border-[var(--border-main)] shadow-inner">
                        <p className="text-xs text-[var(--text-muted)] opacity-60">No extra fields found for this type.</p>
                      </div>
                    ) : (
                      session.jiraMetadata.fields.map((field: JiraField) => (
                        <label 
                          key={field.key}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                            session.visibleFields.includes(field.key) 
                              ? 'bg-[var(--status-info)]/10 border-[var(--status-info)]/30' 
                              : 'bg-[var(--bg-card)] border-[var(--border-main)] hover:border-[var(--status-info)]/30 shadow-[var(--shadow-sm)]'
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-[var(--text-main)]">{field.name}</span>
                            <span className="text-[9px] text-[var(--text-muted)] opacity-70 uppercase tracking-tighter">{field.type} {field.required && '• REQUIRED'}</span>
                          </div>
                          <input 
                            type="checkbox"
                            checked={session.visibleFields.includes(field.key)}
                            onChange={() => {
                              const next = session.visibleFields.includes(field.key)
                                ? session.visibleFields.filter((f: string) => f !== field.key)
                                : [...session.visibleFields, field.key];
                              saveFieldSettings(next);
                            }}
                            className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-[var(--status-info)] focus:ring-[var(--status-info)]/50"
                          />
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* SSL Toggle in Settings */}
                <div className="bg-[var(--bg-card)] border border-[var(--border-main)] p-4 rounded-xl space-y-3 shadow-[var(--shadow-sm)]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 bg-[var(--status-success)] rounded-full"></div>
                    <span className="text-[10px] font-black uppercase text-[var(--status-success)] tracking-widest">Security Configuration</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="verify-ssl-settings"
                      checked={verifySsl} 
                      onChange={e => {
                        const val = e.target.checked;
                        setVerifySsl(val);
                      }}
                      className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-blue-600 focus:ring-blue-500/50"
                    />
                    <label htmlFor="verify-ssl-settings" className="text-xs text-[var(--text-muted)] cursor-pointer">Verify SSL Certificates</label>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] opacity-70 italic">Note: Changing this requires re-verifying the connection.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button 
          type="button"
          onClick={() => setGlobalView('setup')}
          className="w-full bg-[var(--bg-card)] hover:bg-[var(--bg-app)] border border-[var(--border-main)] text-[var(--text-main)] font-bold py-4 rounded-2xl shadow-[var(--shadow-sm)] transition-all flex items-center justify-center gap-2"
        >
          Adjust Jira Connection
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
