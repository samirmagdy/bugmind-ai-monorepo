import { useEffect, useState, useRef } from 'react';
import { X, ChevronDown, Loader2, AlertCircle, RefreshCw, Pencil, FolderOpen, Save, User, Search, Plus, Zap, Check, Moon, Sun } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { IssueType, JiraField, JiraProject, JiraUser } from '../../types';
import LuxurySearchableSelect from '../common/LuxurySearchableSelect';

const HIDDEN_SYSTEM_FIELD_KEYS = new Set([
  'summary',
  'description',
  'project',
  'issuetype'
]);

function isSystemManagedField(field: JiraField): boolean {
  const normalizedKey = field.key.trim().toLowerCase().replace(/[_-]/g, '');
  const normalizedSystem = (field.system || '').trim().toLowerCase();

  return (
    HIDDEN_SYSTEM_FIELD_KEYS.has(field.key.trim().toLowerCase()) ||
    ['summary', 'description', 'project', 'issuetype'].includes(normalizedSystem) ||
    ['projectid', 'issuetypeid', 'pid', 'typeid'].includes(normalizedKey)
  );
}

function normalizeSavedFieldValue(field: JiraField, rawValue: unknown): unknown {
  if (field.type === 'user' || field.type === 'multi-user' || field.type === 'option' || field.type === 'priority' || field.type === 'cascading-select') {
    if (Array.isArray(rawValue)) return rawValue;
    return typeof rawValue === 'object' && rawValue !== null ? rawValue : null;
  }
  if (field.type === 'multi-select') {
    return Array.isArray(rawValue) ? rawValue : [];
  }
  if (field.type === 'labels' || field.type === 'array') {
    if (Array.isArray(rawValue)) {
      return rawValue.map((item) => String(item)).filter(Boolean);
    }
    return [];
  }
  if (field.type === 'number') {
    return rawValue == null || rawValue === '' ? '' : String(rawValue);
  }
  if (field.type === 'boolean') {
    return Boolean(rawValue);
  }
  return rawValue == null ? '' : String(rawValue);
}

const FieldRow: React.FC<{
  field: JiraField;
  savedDefault: any;
  updateFieldDefault: (field: JiraField, nextValue: unknown) => void;
  searchUsers: (query: string, bugIndex?: number, fieldId?: string) => Promise<JiraUser[] | void>;
  isVisible: boolean;
  onToggleVisibility: () => void;
}> = ({ field, savedDefault, updateFieldDefault, searchUsers, isVisible, onToggleVisibility }) => {
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<JiraUser[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const lastSearchedQueryRef = useRef('');
  const dropdownRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    console.log('[BugMind] FieldRow initialized:', field.name, field.type);
  }, [field.name, field.type]);

  useEffect(() => {
    if (userSearchQuery.length < 2) {
      setUserSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (userSearchQuery !== lastSearchedQueryRef.current) {
        setIsSearchingUsers(true);
        lastSearchedQueryRef.current = userSearchQuery;
        try {
          const results = await searchUsers(userSearchQuery, undefined, field.key);
          if (results) {
            setUserSearchResults(results as JiraUser[]);
          }
        } catch {
          // Ignore abort errors
        } finally {
          setIsSearchingUsers(false);
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [userSearchQuery, field.key, searchUsers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div 
      className={`group relative space-y-2.5 p-3 rounded-3xl transition-all duration-500 ${
        isVisible 
          ? 'bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-card)]/50 border-[var(--border-main)] shadow-[var(--shadow-sm)]' 
          : 'bg-[var(--bg-card)]/20 border-dashed border-[var(--border-main)] opacity-70 grayscale-[0.3]'
      } border hover:border-[var(--status-info)]/30 animate-in fade-in slide-in-from-bottom-2`}
    >
      {/* Luxury Header */}
      <div className="flex justify-between items-center px-1">
        <div className="flex flex-col">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] opacity-50 mb-0.5 flex items-center gap-1.5">
            {field.type} 
            {field.required && <span className="text-[var(--status-danger)] font-black text-[11px] leading-none mt-[-2px]">*</span>}
          </label>
          <h3 className={`text-xs font-black tracking-tight transition-colors duration-300 ${isVisible ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>
            {field.name}
          </h3>
        </div>

        {/* Custom Luxury Toggle */}
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
          disabled={field.required}
          className={`relative w-9 h-5 rounded-full transition-all duration-500 border shadow-inner ${
            isVisible 
              ? 'bg-[var(--status-info)] border-[var(--status-info)] shadow-[0_0_12px_rgba(59,130,246,0.3)]' 
              : 'bg-[var(--bg-input)] border-[var(--border-main)] hover:border-[var(--text-muted)]/30'
          } ${field.required ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer active:scale-90'}`}
        >
          <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-lg transition-all duration-500 ${
            isVisible ? 'left-[21px] bg-white' : 'left-[4px] bg-[var(--text-muted)] opacity-40'
          }`} />
        </button>
      </div>

      <div className="relative group/content" onClick={e => e.stopPropagation()}>
        {/* Value Container */}
        <div className={`relative transition-all duration-500 ${!isVisible ? 'pointer-events-none' : ''}`}>
          { (field.type === 'user' || field.type === 'multi-user') ? (
            <div className="relative z-[60]">
              {savedDefault ? (
                <div className="flex items-center justify-between bg-gradient-to-r from-blue-500/5 to-transparent border border-blue-500/10 rounded-[1.25rem] px-4 py-2.5 transition-all hover:bg-blue-500/10 shadow-inner group/val">
                  <div className="flex items-center gap-3">
                    {typeof savedDefault === 'object' && savedDefault !== null && !Array.isArray(savedDefault) && (savedDefault as any).avatar ? (
                      <img src={(savedDefault as any).avatar} className="w-6 h-6 rounded-full ring-2 ring-blue-500/20 shadow-lg" alt="" />
                    ) : (
                      <div className="w-6 h-6 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
                        <User size={12} className="text-blue-500" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-[11px] text-[var(--status-info)] font-black tracking-tight leading-none">
                        {typeof savedDefault === 'object' && savedDefault !== null && !Array.isArray(savedDefault) ? ((savedDefault as any).name || 'Selected User') : 'Selected User'}
                      </span>
                      <span className="text-[9px] text-blue-500/40 uppercase font-bold tracking-tighter mt-1">Default Assignee</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => updateFieldDefault(field, null)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-all rounded-full hover:bg-[var(--status-danger)]/10 group-hover/val:scale-110"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="relative group/input">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within/input:text-[var(--status-info)] transition-all duration-500" size={14} />
                  <input 
                    type="text"
                    placeholder={`Assign a default ${field.name}...`}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] pl-11 pr-4 py-2.5 outline-none transition-all duration-500 text-[11px] placeholder:text-[var(--text-muted)] placeholder:opacity-30 focus:border-[var(--status-info)]/30 focus:ring-4 focus:ring-[var(--status-info)]/5 shadow-inner"
                    value={userSearchQuery}
                    onChange={e => setUserSearchQuery(e.target.value)}
                  />
                  {isSearchingUsers && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <Loader2 size={14} className="animate-spin text-[var(--status-info)]" />
                    </div>
                  )}
                </div>
              )}

              {!savedDefault && userSearchQuery.length >= 2 && (
                <div className="absolute top-full left-0 w-full mt-3 bg-[var(--dropdown-bg)] border border-[var(--dropdown-border)] rounded-[2rem] overflow-hidden z-[999] animate-in fade-in slide-in-from-top-3 duration-500 divide-y divide-[var(--dropdown-border)]">
                  {isSearchingUsers ? (
                    <div className="px-6 py-5 text-center">
                      <Loader2 size={20} className="animate-spin text-[var(--status-info)] mx-auto mb-2 opacity-50" />
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-black opacity-60">Querying Jira...</span>
                    </div>
                  ) : userSearchResults.length > 0 ? (
                    userSearchResults.map((u) => (
                      <button 
                        key={u.id}
                        onClick={() => {
                          updateFieldDefault(field, { id: u.id, name: u.name, avatar: u.avatar });
                          setUserSearchQuery('');
                          setUserSearchResults([]);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--status-info)]/5 text-left transition-all group/item"
                      >
                        {u.avatar ? (
                          <img src={u.avatar} className="w-8 h-8 rounded-full ring-2 ring-transparent group-hover/item:ring-[var(--status-info)]/20 transition-all" alt="" />
                        ) : (
                          <div className="w-8 h-8 bg-[var(--bg-input)] rounded-full flex items-center justify-center border border-[var(--border-main)]">
                            <User size={16} className="text-[var(--text-muted)]" />
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-[11px] text-[var(--text-main)] font-black group-hover:text-[var(--status-info)] transition-colors">{u.name}</span>
                          <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-tight font-bold opacity-40">{u.id}</span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-6 py-6 text-center">
                      <User size={24} className="mx-auto mb-2 text-[var(--text-muted)] opacity-20" />
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-black">No matches found</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (field.allowed_values && field.allowed_values.length > 0) || field.type === 'labels' || field.type === 'array' ? (
            <div className="space-y-3 relative" ref={dropdownRef}>
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`w-full flex items-center justify-between bg-[var(--bg-input)] border rounded-[1.25rem] px-4 py-2.5 outline-none transition-all duration-500 shadow-inner group/trigger ${
                  isDropdownOpen ? 'border-[var(--status-info)]/30 ring-4 ring-[var(--status-info)]/5' : 'border-[var(--border-main)]'
                }`}
              >
                <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
                  {Array.isArray(savedDefault) && savedDefault.length > 0 ? (
                    savedDefault.map((v: any, i: number) => (
                      <div key={typeof v === 'object' ? (v.id || i) : v} className="bg-[var(--status-info)]/10 text-[var(--status-info)] px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight flex items-center gap-2 border border-[var(--status-info)]/20 whitespace-nowrap overflow-hidden max-w-[120px]">
                        <span className="truncate">{typeof v === 'object' ? (v.name || v.value || v.label || v.id) : v}</span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = (savedDefault as any[]).filter((x, idx) => {
                              if (typeof v === 'object' && typeof x === 'object') return x.id !== v.id;
                              return idx !== i;
                            });
                            updateFieldDefault(field, next);
                          }}
                          className="hover:text-[var(--status-danger)] transition-colors opacity-40 hover:opacity-100"
                        >
                          <Plus size={10} className="rotate-45" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-[var(--text-muted)] opacity-40 font-medium">Click to select or type...</span>
                  )}
                </div>
                <ChevronDown className={`text-[var(--text-muted)] opacity-40 transition-transform duration-500 shrink-0 ml-2 ${isDropdownOpen ? 'rotate-180' : ''}`} size={16} />
              </button>

              {isDropdownOpen && (
                <div className="absolute top-full left-0 w-full mt-3 bg-[var(--dropdown-bg)] border border-[var(--dropdown-border)] rounded-[2rem] overflow-hidden z-[999] animate-in fade-in slide-in-from-top-3 duration-500 flex flex-col max-h-[350px]">
                  <div className="p-3 border-b border-[var(--dropdown-border)] sticky top-0 bg-[var(--dropdown-bg)] z-10">
                    <div className="relative group/search">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] opacity-40 group-focus-within/search:text-[var(--status-info)] group-focus-within/search:opacity-100 transition-all" size={14} />
                      <input 
                        type="text"
                        placeholder="Search or type new value..."
                        autoFocus
                        className="w-full bg-[var(--bg-app)] border border-[var(--border-main)] rounded-[1rem] pl-10 pr-4 py-2.5 text-[11px] outline-none focus:border-[var(--status-info)]/30 transition-all font-medium"
                        value={dropdownSearch}
                        onChange={e => setDropdownSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && dropdownSearch.trim()) {
                            e.preventDefault();
                            const val = dropdownSearch.trim();
                            const existing = Array.isArray(savedDefault) ? savedDefault : [];
                            if (!existing.includes(val)) {
                              updateFieldDefault(field, [...existing, val]);
                            }
                            setDropdownSearch("");
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  
                  <div className="overflow-y-auto custom-scrollbar flex-1">
                    {(field.allowed_values || [])
                      .filter(opt => {
                        const s = dropdownSearch.toLowerCase().trim();
                        if (!s) return true;
                        const label = (opt.value || opt.name || opt.label || '').toLowerCase();
                        return label.includes(s);
                      })
                      .map(opt => {
                        const isSelected = Array.isArray(savedDefault) && savedDefault.some((v: any) => 
                          (typeof v === 'object' ? v.id === opt.id : v === (opt.value || opt.name || opt.label))
                        );

                        return (
                          <button 
                            key={opt.id}
                            onClick={() => {
                              const item = { id: opt.id, value: opt.value, name: opt.name, label: opt.label };
                              const existing = Array.isArray(savedDefault) ? savedDefault : [];
                              if (isSelected) {
                                updateFieldDefault(field, existing.filter((v: any) => (typeof v === 'object' ? v.id !== opt.id : v !== (opt.value || opt.name || opt.label))));
                              } else {
                                updateFieldDefault(field, [...existing, item]);
                              }
                            }}
                            className={`w-full flex items-center justify-between px-5 py-2 text-left transition-all group/item border-b border-[var(--border-main)]/30 last:border-0 ${
                              isSelected ? 'bg-[var(--status-info)]/5' : 'hover:bg-[var(--bg-app)]'
                            }`}
                          >
                            <div className="flex flex-col">
                              <span className={`text-[11px] font-black tracking-tight transition-colors ${isSelected ? 'text-[var(--status-info)]' : 'text-[var(--text-main)] group-hover/item:text-[var(--status-info)]'}`}>
                                {opt.value || opt.name || opt.label || opt.id}
                              </span>
                              {opt.id && <span className="text-[9px] text-[var(--text-muted)] font-bold opacity-30 uppercase tracking-tighter">Option ID: {opt.id}</span>}
                            </div>
                            {isSelected && (
                              <div className="bg-[var(--status-info)] p-1 rounded-lg shadow-[0_0_10px_rgba(59,130,246,0.4)] animate-in zoom-in-50 duration-300">
                                <Check size={12} className="text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    
                    {dropdownSearch.trim() && !(field.allowed_values || []).some(o => (o.value || o.name || o.label || '').toLowerCase() === dropdownSearch.toLowerCase()) && (
                      <button 
                        onClick={() => {
                          const val = dropdownSearch.trim();
                          const existing = Array.isArray(savedDefault) ? savedDefault : [];
                          if (!existing.includes(val)) {
                            updateFieldDefault(field, [...existing, val]);
                          }
                          setDropdownSearch("");
                        }}
                        className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--status-info)]/5 text-left transition-all group/add"
                      >
                        <div className="p-1.5 bg-[var(--status-info)]/10 rounded-lg text-[var(--status-info)]">
                          <Plus size={14} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[11px] font-black text-[var(--text-main)]">Add custom value</span>
                          <span className="text-[10px] text-[var(--status-info)] font-bold uppercase tracking-tight">"{dropdownSearch.trim()}"</span>
                        </div>
                      </button>
                    )}

                    {(field.allowed_values || []).length === 0 && !dropdownSearch.trim() && (
                      <div className="px-6 py-10 text-center">
                        <FolderOpen size={24} className="mx-auto mb-3 text-[var(--text-muted)] opacity-20" />
                        <p className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-widest opacity-40 leading-relaxed">
                          No predefined options.<br/>Type above to add manually.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : field.type === 'boolean' ? (
            <div className="bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] p-3 flex items-center justify-between shadow-inner group/bool">
              <span className="text-[11px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-60">Enabled by Default</span>
              <button
                onClick={() => updateFieldDefault(field, !savedDefault)}
                className={`relative w-10 h-6 rounded-full transition-all duration-500 border ${
                  savedDefault ? 'bg-[var(--status-success)] border-[var(--status-success)] shadow-[0_0_12px_rgba(34,197,94,0.3)]' : 'bg-[var(--bg-card)] border-[var(--border-main)]'
                }`}
              >
                <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-500 ${
                  savedDefault ? 'left-[20px]' : 'left-[4px]'
                }`} />
              </button>
            </div>
          ) : (
            <div className="relative group/text">
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={typeof savedDefault === 'string' || typeof savedDefault === 'number' ? String(savedDefault) : ''}
                onChange={(e) => updateFieldDefault(field, field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] px-4 py-2.5 outline-none transition-all duration-500 text-[11px] text-[var(--text-main)] shadow-inner focus:border-[var(--status-info)]/30 focus:ring-4 focus:ring-[var(--status-info)]/5 font-medium placeholder:opacity-20"
                placeholder={field.type === 'number' ? "0" : "No default value set..."}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-[var(--text-muted)] opacity-20 uppercase tracking-tighter pointer-events-none group-focus-within/text:opacity-40 transition-opacity">
                {field.type}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingsView: React.FC = () => {
  const { 
    session, updateSession, handleSaveSettings, saveFieldSettings,
    ai: { customKey, setCustomKey, hasCustomKeySaved, customModel, setCustomModel, searchUsers },
    jira, refreshIssue, currentTabId,
    auth: { apiBase, setApiBase },
    debug: { log }
  } = useBugMind();
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, { auth_type: string; host_url: string; username: string; token: string; verify_ssl: boolean }>>({});
  const [projectsByConnection, setProjectsByConnection] = useState<Record<number, JiraProject[]>>({});
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [newConnection, setNewConnection] = useState({
    auth_type: 'cloud',
    host_url: session.instanceUrl || '',
    username: '',
    token: '',
    verify_ssl: jira.verifySsl
  });
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);
  const editableJiraFields = (session.jiraMetadata?.fields || []).filter((field: JiraField) => !isSystemManagedField(field));

  const updateFieldDefault = (field: JiraField, nextValue: unknown) => {
    const nextDefaults = { ...(session.fieldDefaults || {}) };
    const isEmptyValue =
      nextValue == null ||
      nextValue === '' ||
      (Array.isArray(nextValue) && nextValue.length === 0);

    if (isEmptyValue) {
      delete nextDefaults[field.key];
    } else {
      nextDefaults[field.key] = nextValue;
    }

    saveFieldSettings(undefined, undefined, nextDefaults);
  };

  // Auto-refetch when entering Jira tab if empty
  useEffect(() => {
    if (session.settingsTab === 'jira' && session.issueTypes.length === 0 && !session.issueTypesFetched && !session.error && session.instanceUrl && !session.loading) {
      log('SETTINGS-AUTO', 'Mapping tab empty, triggering background sync...');
      refreshIssue(true);
    }
  }, [session.settingsTab, session.issueTypes.length, session.issueTypesFetched, session.error, session.instanceUrl, session.loading, refreshIssue, log]);

  useEffect(() => {
    if (session.settingsTab !== 'connections') return;
    if (session.connections && session.connections.length > 0) return;
    void jira.fetchConnections();
  }, [jira, session.connections, session.settingsTab]);

  useEffect(() => {
    if (!showAddConnection) return;
    setNewConnection((prev) => ({
      ...prev,
      host_url: prev.host_url || session.instanceUrl || '',
      verify_ssl: jira.verifySsl
    }));
  }, [jira.verifySsl, session.instanceUrl, showAddConnection]);

  const bootstrapJiraConfig = async (issueTypeId?: string, options?: { force?: boolean; loading?: boolean; logTag?: string; errorMessage?: string }) => {
    const projectKey = session.issueData?.key.split('-')[0];
    if (!projectKey || !session.instanceUrl || !session.issueData) return null;

    const force = options?.force ?? true;
    const showLoading = options?.loading ?? false;

    if (showLoading) {
      updateSession({ loading: true }, currentTabId);
    }

    if (options?.logTag) {
      log(options.logTag, `Bootstrapping Jira config for ${projectKey}${issueTypeId ? ` (${issueTypeId})` : ''}`);
    }

    try {
      return await jira.bootstrapContext({
        instanceUrl: session.instanceUrl,
        issueKey: session.issueData.key,
        projectKey,
        projectId: session.jiraMetadata?.project_id || session.issueData.projectId,
        issueTypeId,
        tabId: currentTabId,
        force
      });
    } catch {
      if (options?.errorMessage) {
        updateSession({ error: options.errorMessage }, currentTabId);
      }
      return null;
    } finally {
      if (showLoading) {
        updateSession({ loading: false }, currentTabId);
      }
    }
  };

  return (
    <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
      <div className="context-card flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <button onClick={() => updateSession({ view: 'main' })} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-soft)] border border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--primary-blue)] hover:border-[var(--primary-blue)] transition-all">
            <X size={16} />
          </button>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--text-muted)]">Preferences</p>
            <h2 className="text-[20px] font-extrabold tracking-[-0.04em] text-[var(--text-primary)]">Settings</h2>
          </div>
        </div>
        <div className="hidden min-[360px]:flex items-center rounded-full bg-[var(--surface-soft)] border border-[var(--card-border)] px-3 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">
          Native polish
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 rounded-[1.4rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-1.5">
        <button 
          onClick={() => updateSession({ settingsTab: 'ai' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'ai' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          AI Engine
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'jira' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'jira' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Field Map
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'connections' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'connections' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Connections
        </button>
      </div>

      <div className="context-card flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Appearance</p>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Theme</h3>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Switch between the refreshed light palette and the new dark surface system.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateSession({
            theme: session.theme === 'dark' ? 'light' : 'dark',
            themeSource: 'manual'
          })}
          className="flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-soft-hover)]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--primary-blue)]">
            {session.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </span>
          <span>{session.theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>

      {session.settingsTab === 'ai' ? (
        <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500">
          <div className="context-card space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[var(--primary-blue)] rounded-full animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Platform Settings</span>
            </div>
            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">BugMind API Endpoint</label>
              <input 
                type="url" 
                value={apiBase} 
                onChange={e => {
                  const val = e.target.value;
                  setApiBase(val);
                  chrome.storage.local.set({ 'bugmind_api_base': val.trim().replace(/\/+$/, '') });
                }}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/10 transition-all"
                placeholder="https://api.bugmind.ai/api/v1"
              />
            </div>
          </div>

          <div className="context-card space-y-3 bg-[linear-gradient(180deg,var(--surface-accent-strong),var(--card-surface-bottom))]">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[var(--primary-blue)]" fill="currentColor" />
              <p className="text-[11px] text-[var(--primary-blue)] font-bold tracking-[0.16em] uppercase">Custom AI Credentials</p>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Override BugMind&apos;s default AI with your own OpenRouter credentials. Leave empty to use the platform default.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="context-card space-y-4">
            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">OpenRouter API Key</label>
              <input 
                type="password" 
                value={customKey} 
                onChange={e => setCustomKey(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/10 transition-all"
                placeholder={hasCustomKeySaved ? "••••••••••••••••" : "sk-or-v1-..."}
              />
              {hasCustomKeySaved && (
                <div className="flex items-center gap-1.5 ml-1 mt-1">
                  <Check size={12} className="text-[var(--success)]" />
                  <p className="text-[10px] text-[var(--success)] font-bold">Custom key active</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">AI Model ID</label>
              <input 
                type="text" 
                value={customModel} 
                onChange={e => setCustomModel(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/10 transition-all"
                placeholder="e.g. anthropic/claude-3-sonnet"
              />
              <p className="text-[11px] text-[var(--text-muted)] ml-1">Format: vendor/model-name</p>
            </div>

            <button
              type="submit"
              disabled={session.loading}
              className="w-full bg-[var(--primary-gradient)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-[1.25rem] transition-all shadow-[var(--shadow-button)] flex items-center justify-center gap-2 text-sm"
            >
              {session.loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {session.loading ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
        </div>
      ) : session.settingsTab === 'connections' ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-[11px] font-black uppercase text-[var(--text-muted)] tracking-[0.2em]">Active Connections</h3>
            <button 
              onClick={() => {
                setShowAddConnection(prev => !prev);
                setEditingConnectionId(null);
              }}
              className="rounded-full border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-[var(--primary-blue)]"
            >
              {showAddConnection ? 'Close' : 'Add Connection'}
            </button>
          </div>

          {showAddConnection && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setIsCreatingConnection(true);
                try {
                  const connected = await jira.createConnection({
                    auth_type: newConnection.auth_type as 'cloud' | 'server',
                    base_url: newConnection.host_url.trim(),
                    username: newConnection.username.trim(),
                    token: newConnection.token,
                    verify_ssl: newConnection.verify_ssl
                  });

                  if (connected) {
                    updateSession({ success: 'Connection saved successfully.' });
                    setShowAddConnection(false);
                    setNewConnection({
                      auth_type: 'cloud',
                      host_url: session.instanceUrl || '',
                      username: '',
                      token: '',
                      verify_ssl: jira.verifySsl
                    });
                  } else {
                    updateSession({ error: 'Failed to save Jira connection.' });
                  }
                } finally {
                  setIsCreatingConnection(false);
                }
              }}
              className="context-card p-4 space-y-3"
            >
              <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Add New Connection</div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Authentication Protocol</div>
                <LuxurySearchableSelect
                  options={[
                    { id: 'cloud', name: 'Atlassian Cloud (API Token)' },
                    { id: 'server', name: 'Jira Data Center (PAT)' }
                  ]}
                  value={{ id: newConnection.auth_type }}
                  onChange={(next: any) => setNewConnection(prev => ({ ...prev, auth_type: next.id }))}
                />
              </div>
              <input
                type="url"
                value={newConnection.host_url}
                onChange={(e) => setNewConnection(prev => ({ ...prev, host_url: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                placeholder={newConnection.auth_type === 'cloud' ? 'https://company.atlassian.net' : 'http://jira.internal.com'}
                required
              />
              <input
                type="text"
                value={newConnection.username}
                onChange={(e) => setNewConnection(prev => ({ ...prev, username: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                placeholder="Email / username"
                required
              />
              <input
                type="password"
                value={newConnection.token}
                onChange={(e) => setNewConnection(prev => ({ ...prev, token: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                placeholder="API Token / PAT"
                required
              />
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={newConnection.verify_ssl}
                  onChange={(e) => setNewConnection(prev => ({ ...prev, verify_ssl: e.target.checked }))}
                />
                Verify SSL certificates
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isCreatingConnection}
                  className="flex-1 bg-[var(--primary-gradient)] text-white font-bold py-2.5 rounded-2xl text-[11px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-[var(--shadow-button)]"
                >
                  <Save size={12} />
                  {isCreatingConnection ? 'Saving...' : 'Add New Connection'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddConnection(false)}
                  className="px-3 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl text-[11px]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {(!session.connections || session.connections.length === 0) ? (
              <div className="py-8 text-center bg-[var(--bg-input)] rounded-[1.5rem] border border-dashed border-[var(--border-main)]">
                <p className="text-[11px] text-[var(--text-muted)]">No connections found.</p>
              </div>
            ) : (
              session.connections.map((conn) => (
                <div 
                  key={conn.id} 
                  className={`context-card p-3.5 transition-all ${
                    session.jiraConnectionId === conn.id 
                      ? 'bg-[var(--accent)]/5 border-[var(--accent)] shadow-md' 
                      : 'bg-[var(--bg-card)] border-[var(--border-main)]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                      <div className="w-8 h-8 rounded-xl bg-[var(--bg-input)] flex items-center justify-center border border-[var(--border-main)] shrink-0">
                        {conn.icon_url ? (
                          <img src={conn.icon_url} className="w-6 h-6 rounded-md" alt="" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[var(--text-main)] leading-tight truncate">{conn.username}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{conn.host_url}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        onClick={() => {
                          setEditingConnectionId(conn.id);
                          setConnectionDrafts(prev => ({
                            ...prev,
                            [conn.id]: prev[conn.id] || {
                              auth_type: conn.auth_type,
                              host_url: conn.host_url,
                              username: conn.username,
                              token: '',
                              verify_ssl: conn.verify_ssl ?? true
                            }
                          }));
                        }}
                        className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                        title="Edit connection"
                      >
                        <Pencil size={14} />
                      </button>
                      {session.jiraConnectionId !== conn.id && (
                        <button 
                          onClick={() => jira.setActiveConnection(conn.id, conn.host_url)}
                          className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                          title="Set as Active"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button 
                        onClick={async () => {
                          const projects = await jira.fetchProjects(conn.id);
                          setProjectsByConnection(prev => ({ ...prev, [conn.id]: projects }));
                        }}
                        className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                        title="Load projects"
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button 
                        onClick={() => jira.deleteConnection(conn.id)}
                        className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-lg transition-all"
                        title="Delete connection"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {session.jiraConnectionId === conn.id && (
                    <div className="mt-2 pt-2 border-t border-[var(--accent)]/10 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
                      <span className="text-[10px] font-bold text-[var(--status-success)] uppercase tracking-widest">Active Connection</span>
                    </div>
                  )}
                  {projectsByConnection[conn.id] && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-main)] space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Accessible Projects</div>
                      <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                        {projectsByConnection[conn.id].slice(0, 10).map(project => (
                          <div key={`${conn.id}-${project.id}`} className="text-[11px] text-[var(--text-muted)]">
                            <span className="font-bold text-[var(--text-main)]">{project.key}</span> {project.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {editingConnectionId === conn.id && connectionDrafts[conn.id] && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const draft = connectionDrafts[conn.id];
                        const ok = await jira.updateConnection(conn.id, {
                          auth_type: draft.auth_type,
                          host_url: draft.host_url.trim(),
                          username: draft.username.trim(),
                          token: draft.token.trim() || undefined,
                          verify_ssl: draft.verify_ssl
                        });
                        if (ok) {
                          setEditingConnectionId(null);
                          const projects = await jira.fetchProjects(conn.id);
                          setProjectsByConnection(prev => ({ ...prev, [conn.id]: projects }));
                        }
                      }}
                      className="mt-3 pt-3 border-t border-[var(--border-main)] space-y-3"
                    >
                      <div className="space-y-1">
                        <LuxurySearchableSelect
                          options={[
                            { id: 'cloud', name: 'Jira Cloud' },
                            { id: 'server', name: 'Server / DC' }
                          ]}
                          value={{ id: connectionDrafts[conn.id].auth_type }}
                          onChange={(next: any) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], auth_type: next.id } }))}
                        />
                      </div>
                      <input
                        type="url"
                        value={connectionDrafts[conn.id].host_url}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], host_url: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                        placeholder="https://company.atlassian.net"
                      />
                      <input
                        type="text"
                        value={connectionDrafts[conn.id].username}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], username: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                        placeholder="Email / username"
                      />
                      <input
                        type="password"
                        value={connectionDrafts[conn.id].token}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], token: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                        placeholder="Leave blank to keep current token"
                      />
                      <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={connectionDrafts[conn.id].verify_ssl}
                          onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], verify_ssl: e.target.checked } }))}
                        />
                        Verify SSL certificates
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" className="flex-1 bg-[var(--primary-gradient)] text-white font-bold py-2.5 rounded-2xl text-[11px] flex items-center justify-center gap-2 shadow-[var(--shadow-button)]">
                          <Save size={12} />
                          Save Connection
                        </button>
                        <button type="button" onClick={() => setEditingConnectionId(null)} className="px-3 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl text-[11px]">
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="context-card space-y-2.5 relative overflow-hidden">
            <p className="text-[10px] text-[var(--status-success)] uppercase font-black tracking-[0.18em] opacity-80">Project Configuration</p>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Target project: <strong className="text-[var(--text-main)]">{session.issueData?.key.split('-')[0]}</strong>. Settings are saved per issue type.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-60 ml-1">Select Issue Type</label>
              <div className="relative flex items-center gap-3">
                {session.selectedIssueType?.icon_url && (
                  <div className="w-11 h-11 rounded-[1rem] bg-[var(--bg-input)] flex items-center justify-center border border-[var(--border-main)] shrink-0 group">
                    <img src={session.selectedIssueType.icon_url} className="w-6 h-6 group-hover:scale-110 transition-transform" alt="" />
                  </div>
                )}
                <div className="flex-1">
                  <LuxurySearchableSelect 
                    options={session.issueTypes.map((type: IssueType) => ({ id: type.id, name: type.name, avatar: type.icon_url }))}
                    value={session.selectedIssueType}
                    placeholder="Select issue type..."
                    onChange={(type: any) => {
                      if (type && session.jiraConnectionId && session.issueData) {
                        updateSession({ selectedIssueType: type, jiraMetadata: null });
                        void bootstrapJiraConfig(type.id, { force: true, loading: true, logTag: 'SETTINGS-TYPE' });
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {!session.jiraMetadata ? (
              session.error?.includes('Jira fields') || session.error?.includes('issue types') ? (
                <div className="context-card py-10 px-6 text-center border-[var(--status-danger)]/20 bg-[var(--error-bg)] space-y-4 animate-in zoom-in duration-500">
                  <div className="w-10 h-10 bg-[var(--status-danger)]/10 rounded-2xl flex items-center justify-center text-[var(--status-danger)] mx-auto border border-[var(--status-danger)]/10">
                    <AlertCircle size={28} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[var(--status-danger)] text-[10px] font-black uppercase tracking-widest">Configuration Error</div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-4">{session.error}</p>
                  </div>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.instanceUrl && session.issueData) {
                        updateSession({ error: null });
                        if (session.issueTypes.length === 0) {
                          void bootstrapJiraConfig(undefined, { force: true, loading: true, logTag: 'SETTINGS-RETRY', errorMessage: 'Failed to refresh issue types.' });
                        } else if (session.selectedIssueType) {
                          void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-RETRY', errorMessage: 'Failed to refresh Jira fields.' });
                        }
                      }
                    }}
                    className="w-full bg-[var(--status-danger)]/10 hover:bg-[var(--status-danger)]/15 border border-[var(--status-danger)]/20 text-[var(--status-danger)] text-[10px] font-black py-2.5 rounded-[1rem] transition-all uppercase tracking-[0.18em]"
                  >
                    Retry Discovery
                  </button>
                </div>
              ) : session.issueTypesFetched && session.issueTypes.length === 0 ? (
                <div className="context-card py-12 px-6 text-center bg-[var(--warning-bg)] border-[var(--status-warning)]/20 space-y-5 animate-in zoom-in duration-500">
                  <div className="w-10 h-10 bg-[var(--status-warning)]/10 rounded-2xl flex items-center justify-center text-[var(--status-warning)] mx-auto border border-[var(--status-warning)]/10">
                    <AlertCircle size={28} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-[var(--text-main)] text-base font-black tracking-tight">No Issue Types Found</div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-4 opacity-80 italic">
                      Verify your Jira account has "Browse Projects" permissions for project <strong>{session.issueData?.key.split('-')[0]}</strong>.
                    </p>
                  </div>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.instanceUrl && session.issueData) {
                        updateSession({ error: null, issueTypesFetched: false });
                        void bootstrapJiraConfig(undefined, { force: true, loading: true, logTag: 'SETTINGS-REFRESH', errorMessage: 'Failed to refresh issue types.' });
                      }
                    }}
                    className="w-full bg-[var(--status-info)]/10 hover:bg-[var(--status-info)]/15 border border-[var(--status-info)]/20 text-[var(--status-info)] text-[10px] font-black py-2.5 rounded-[1rem] transition-all uppercase tracking-[0.18em]"
                  >
                    Refresh Project Config
                  </button>
                </div>
              ) : (
                <div className="py-16 text-center flex flex-col items-center gap-3 animate-in fade-in duration-700">
                  <div className="relative">
                    <div className="absolute inset-0 bg-[var(--status-info)]/20 blur-2xl rounded-full animate-pulse"></div>
                    <Loader2 className="animate-spin text-[var(--status-info)]/60 relative" size={40} />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[var(--text-muted)] opacity-50">Syncing Schema...</div>
                </div>
              )
            ) : (
              <div className="space-y-6">
                <div className="context-card flex justify-between items-center px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[var(--status-success)] animate-pulse"></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest opacity-60">Schema Loaded</span>
                      <span className="text-[9px] text-[var(--status-success)] font-black uppercase tracking-tighter">Verified with Jira</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.issueData && session.selectedIssueType) {
                        void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-FORCE', errorMessage: 'Failed to refresh Jira fields.' });
                      }
                    }}
                    className="text-[10px] font-black uppercase tracking-widest text-[var(--status-info)] transition-colors flex items-center gap-1.5 p-2 px-3 rounded-full bg-[var(--status-info)]/10 hover:bg-[var(--status-info)]/15"
                  >
                    <RefreshCw size={10} />
                    Force Refresh
                  </button>
                </div>

                {/* AI Property Mapping Section */}
                <div className="context-card p-5 space-y-5 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 bg-[var(--status-info)] rounded-full"></div>
                      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--status-info)]">Property Intelligence</span>
                    </div>
                    <Zap size={14} className="text-[var(--status-info)] opacity-50" />
                  </div>
                  
                  <div className="space-y-4">
                    {[
                      { id: 'steps_to_reproduce', label: 'Steps to Reproduce' },
                      { id: 'expected_result', label: 'Expected Result' },
                      { id: 'actual_result', label: 'Actual Result' }
                    ].map(prop => (
                      <div key={prop.id} className="space-y-2.5">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] opacity-50 ml-1">{prop.label}</label>
                        <div className="relative group/select">
                          <LuxurySearchableSelect 
                            options={[
                              { id: 'description', name: 'Description (System Default)' },
                              ...editableJiraFields.map((f: JiraField) => ({ id: f.key, name: `${f.name} — ${f.key}` }))
                            ]}
                            value={{ id: (session.aiMapping?.[prop.id]) || 'description' }}
                            onChange={(next: any) => {
                              const nextMapping = { ...(session.aiMapping || {}), [prop.id]: next.id };
                              saveFieldSettings(undefined, nextMapping);
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Visible Fields Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-60">Available Fields</label>
                      <button 
                        onClick={() => {
                          if (session.issueData && session.selectedIssueType) {
                            void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-FIELDS', errorMessage: 'Failed to refresh Jira fields.' });
                          }
                        }}
                        disabled={session.loading}
                        className={`p-1.5 rounded-lg hover:bg-[var(--status-info)]/10 text-[var(--status-info)] transition-all ${session.loading ? 'opacity-50 cursor-not-allowed' : ''} border border-transparent hover:border-[var(--status-info)]/20`}
                        title="Force refresh available fields"
                      >
                        <RefreshCw size={12} className={session.loading ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    <span className="text-[9px] text-[var(--status-info)] font-black uppercase tracking-widest bg-[var(--status-info)]/10 px-2.5 py-1 rounded-full border border-[var(--status-info)]/10">{editableJiraFields.length} Available</span>
                  </div>
                  <div className="max-h-[550px] overflow-y-auto pr-2 custom-scrollbar space-y-4 pb-12">
                    {editableJiraFields.length === 0 ? (
                      <div className="py-20 text-center bg-[var(--bg-input)] rounded-[1.5rem] border border-dashed border-[var(--border-main)]">
                        <p className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] opacity-40 italic">Discovery in progress or no fields found</p>
                      </div>
                    ) : (
                      [...editableJiraFields]
                        .sort((a, b) => {
                          const aVis = (session.visibleFields.includes(a.key) || a.required) ? 1 : 0;
                          const bVis = (session.visibleFields.includes(b.key) || b.required) ? 1 : 0;
                          if (aVis !== bVis) return bVis - aVis;
                          return a.name.localeCompare(b.name);
                        })
                        .map((field: JiraField) => (
                          <FieldRow 
                            key={field.key}
                            field={field}
                            savedDefault={normalizeSavedFieldValue(field, session.fieldDefaults?.[field.key])}
                            updateFieldDefault={updateFieldDefault}
                            searchUsers={searchUsers}
                            isVisible={session.visibleFields.includes(field.key) || field.required}
                            onToggleVisibility={() => {
                              if (field.required) return;
                              const next = session.visibleFields.includes(field.key)
                                ? session.visibleFields.filter((f: string) => f !== field.key)
                                : [...session.visibleFields, field.key];
                              saveFieldSettings(next);
                            }}
                          />
                        ))
                    )}
                  </div>
                </div>

                {/* Security Section */}
                <div className="context-card p-5 space-y-4 relative overflow-hidden">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 bg-[var(--status-success)] rounded-full"></div>
                    <span className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--status-success)]">Protocol Hardening</span>
                  </div>
                  
                  <div className="flex items-center justify-between bg-[var(--bg-input)]/50 p-3 rounded-[1.25rem] border border-[var(--border-main)]/50">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black tracking-tight text-[var(--text-main)]">SSL Certificate Verification</span>
                      <span className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-tighter mt-0.5">TLS Enforcement</span>
                    </div>
                    <button
                      onClick={() => jira.setVerifySsl(!jira.verifySsl)}
                      className={`relative w-10 h-6 rounded-full transition-all duration-500 border ${
                        jira.verifySsl ? 'bg-[var(--status-success)] border-[var(--status-success)] shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-[var(--bg-card)] border-[var(--border-main)]'
                      }`}
                    >
                      <div className={`absolute top-1/2 -translate-y-1/2 w-4.5 h-4.5 rounded-full bg-white shadow-md transition-all duration-500 ${
                        jira.verifySsl ? 'left-[19px]' : 'left-[3px]'
                      }`} />
                    </button>
                  </div>
                  
                  <div className="flex gap-3 px-1">
                    <div className="w-1 bg-[var(--border-main)] rounded-full opacity-30"></div>
                    <p className="text-[10px] text-[var(--text-muted)] opacity-60 leading-relaxed font-medium">
                      Standard protocol for Jira Data Center. Disable only if using self-signed certificates in a controlled environment.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default SettingsView;
