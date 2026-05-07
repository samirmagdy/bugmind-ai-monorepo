import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import { X, ChevronDown, Loader2, AlertCircle, RefreshCw, Pencil, FolderOpen, Save, User, Search, Plus, Zap, Check, Moon, Sun, Users, Layout, Shield, ChevronRight, HelpCircle, Languages, Download, Upload, ClipboardList } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { IssueType, JiraCapabilityProfile, JiraConnection, JiraField, JiraProject, JiraUser } from '../../types';
import { ActionButton, StatusBadge, StatusPanel, SurfaceCard } from '../common/DesignSystem';
import LuxurySearchableSelect, { SelectOption, SelectValue } from '../common/LuxurySearchableSelect';
import { apiRequest, readJsonResponse, throwApiErrorResponse } from '../../services/api';
import { useI18n } from '../../i18n';
import {
  buildAdminDiagnosticReport,
  buildCapabilityFeatures,
  buildDryRunReport,
  buildJiraReadinessItems,
  getJiraReadinessScore,
  getMappedSourceStoryFields,
  getMissingRequiredTargetFieldKeys,
  getProfileProjectParams,
  jiraCapabilityService,
  sanitizeJiraCapabilityProfile
} from '../../services/JiraCapabilityService';

const HIDDEN_SYSTEM_FIELD_KEYS = new Set([
  'summary',
  'description',
  'project',
  'issuetype',
  'issuelinks'
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
  if (field.type === 'user' || field.type === 'multi-user' || field.type === 'option' || field.type === 'priority' || field.type === 'cascading-select' || field.type === 'sprint') {
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

type SavedFieldValue =
  | string
  | number
  | boolean
  | null
  | { id: string; name?: string; value?: string; label?: string; avatar?: string }
  | Array<string | { id: string; name?: string; value?: string; label?: string; avatar?: string }>;

function isSelectOption(value: SelectValue | SelectValue[]): value is SelectOption {
  return !Array.isArray(value) && typeof value === 'object' && value !== null;
}

function isConnectionAuthType(value: unknown): value is 'cloud' | 'server' {
  return value === 'cloud' || value === 'server';
}

function normalizeApiBaseInput(value: string): string {
  let trimmed = value.trim().replace(/\/+$/, '');
  trimmed = trimmed.replace(/\/(auth|jira|ai|settings|stripe)(?:\/.*)?$/i, '');
  if (trimmed.endsWith('/api')) return `${trimmed}/v1`;
  if (!trimmed.endsWith('/api/v1')) {
    trimmed = trimmed.replace(/\/api\/v1\/.*$/i, '/api/v1');
  }
  return trimmed;
}

const FieldRow: React.FC<{
  field: JiraField;
  savedDefault: SavedFieldValue;
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
      className={`workflow-card group relative space-y-3 p-3.5 transition-all duration-300 ${
        isVisible 
          ? 'border-[var(--card-border)]' 
          : 'border-dashed border-[var(--border-main)] opacity-75'
      } hover:border-[var(--status-info)]/30 animate-in fade-in slide-in-from-bottom-2`}
    >
      <div className="flex justify-between items-center px-1">
        <div className="flex flex-col">
          <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] opacity-60 mb-0.5 flex items-center gap-1.5">
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
          className={`relative w-9 h-5 rounded-full transition-all duration-300 border ${
            isVisible 
              ? 'bg-[var(--status-info)] border-[var(--status-info)]' 
              : 'bg-[var(--bg-input)] border-[var(--border-main)] hover:border-[var(--text-muted)]/30'
          } ${field.required ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer active:scale-90'}`}
        >
          <div className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all duration-300 ${
            isVisible ? 'left-[21px] bg-[var(--bg-elevated)]' : 'left-[4px] bg-[var(--text-muted)] opacity-40'
          }`} />
        </button>
      </div>

      <div className="relative group/content" onClick={e => e.stopPropagation()}>
        {/* Value Container */}
        <div className={`relative transition-all duration-500 ${!isVisible ? 'pointer-events-none' : ''}`}>
          { (field.type === 'user' || field.type === 'multi-user') ? (
            <div className="relative z-[60]">
              {savedDefault ? (
                <div className="flex items-center justify-between bg-[var(--surface-soft)] border border-[var(--card-border)] rounded-[1.25rem] px-4 py-2.5 transition-all hover:bg-[var(--surface-soft-hover)] group/val">
                  <div className="flex items-center gap-3">
                    {typeof savedDefault === 'object' && savedDefault !== null && !Array.isArray(savedDefault) && savedDefault.avatar ? (
                      <img src={savedDefault.avatar} className="w-6 h-6 rounded-full ring-2 ring-[var(--status-info)]/20" alt="" />
                    ) : (
                      <div className="w-6 h-6 bg-[var(--status-info)]/10 rounded-full flex items-center justify-center border border-[var(--status-info)]/20">
                        <User size={12} className="text-[var(--status-info)]" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-[11px] text-[var(--status-info)] font-black tracking-tight leading-none">
                        {typeof savedDefault === 'object' && savedDefault !== null && !Array.isArray(savedDefault) ? (savedDefault.name || 'Selected User') : 'Selected User'}
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
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] pl-11 pr-4 py-2.5 outline-none transition-all duration-300 text-[11px] placeholder:text-[var(--text-muted)] placeholder:opacity-30 focus:border-[var(--status-info)]/30 focus:ring-4 focus:ring-[var(--status-info)]/5"
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
          ) : ((field.type === 'option' || field.type === 'priority' || field.type === 'cascading-select' || field.type === 'sprint') && field.allowed_values && field.allowed_values.length > 0) ? (
            <LuxurySearchableSelect
              options={(field.allowed_values || []).map((opt) => ({
                id: opt.id,
                name: opt.name || opt.value || opt.label || opt.id,
                label: opt.label,
              }))}
              value={typeof savedDefault === 'object' && savedDefault !== null && !Array.isArray(savedDefault)
                ? {
                    id: savedDefault.id,
                    name: savedDefault.name || savedDefault.value || savedDefault.label || savedDefault.id,
                    label: savedDefault.label,
                  }
                : null}
              onChange={(next) => {
                if (!next || Array.isArray(next)) {
                  updateFieldDefault(field, null);
                  return;
                }
                if (isSelectOption(next)) {
                  updateFieldDefault(field, {
                    id: String(next.id ?? ''),
                    name: next.name,
                    label: next.label,
                    value: next.name,
                  });
                }
              }}
              placeholder={field.type === 'sprint' ? 'Choose sprint...' : 'Choose value...'}
            />
          ) : (field.allowed_values && field.allowed_values.length > 0) || field.type === 'labels' || field.type === 'array' ? (
            <div className="space-y-3 relative" ref={dropdownRef}>
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`w-full flex items-center justify-between bg-[var(--bg-input)] border rounded-[1.25rem] px-4 py-2.5 outline-none transition-all duration-300 group/trigger ${
                  isDropdownOpen ? 'border-[var(--status-info)]/30 ring-4 ring-[var(--status-info)]/5' : 'border-[var(--border-main)]'
                }`}
              >
                <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
                  {Array.isArray(savedDefault) && savedDefault.length > 0 ? (
                    savedDefault.map((v, i: number) => (
                      <div key={typeof v === 'object' ? (v.id || i) : v} className="bg-[var(--status-info)]/10 text-[var(--status-info)] px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight flex items-center gap-2 border border-[var(--status-info)]/20 whitespace-nowrap overflow-hidden max-w-[120px]">
                        <span className="truncate">{typeof v === 'object' ? (v.name || v.value || v.label || v.id) : v}</span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = savedDefault.filter((x, idx) => {
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
                        const optKey = String(opt.id ?? opt.value ?? opt.name ?? opt.label ?? '');
                        const isSelected = Array.isArray(savedDefault) && savedDefault.some((v) =>
                          (typeof v === 'object'
                            ? String(v.id ?? v.value ?? v.name ?? v.label ?? '') === optKey
                            : String(v) === optKey)
                        );

                        return (
                          <button 
                            key={optKey}
                            onClick={() => {
                              const item = { id: opt.id, value: opt.value, name: opt.name, label: opt.label };
                              const existing = Array.isArray(savedDefault) ? savedDefault : [];
                              if (isSelected) {
                                updateFieldDefault(field, existing.filter((v) => (
                                  typeof v === 'object'
                                    ? String(v.id ?? v.value ?? v.name ?? v.label ?? '') !== optKey
                                    : String(v) !== optKey
                                )));
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
            <div className="bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] p-3 flex items-center justify-between group/bool">
              <span className="text-[11px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-60">Enabled by Default</span>
              <button
                onClick={() => updateFieldDefault(field, !savedDefault)}
                className={`relative w-10 h-6 rounded-full transition-all duration-300 border ${
                  savedDefault ? 'bg-[var(--status-success)] border-[var(--status-success)]' : 'bg-[var(--bg-card)] border-[var(--border-main)]'
                }`}
              >
                <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--bg-elevated)] transition-all duration-300 ${
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
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-[1.25rem] px-4 py-2.5 outline-none transition-all duration-300 text-[11px] text-[var(--text-main)] focus:border-[var(--status-info)]/30 focus:ring-4 focus:ring-[var(--status-info)]/5 font-medium placeholder:opacity-20"
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
    ai: { customKey, setCustomKey, hasCustomKeySaved, clearCustomKeyRequested, setClearCustomKeyRequested, customModel, setCustomModel, searchUsers },
    jira, refreshIssue, currentTabId,
    auth: { apiBase, setApiBase, authToken, refreshSession },
    debug: { log }
  } = useBugMind();
  const { t, locale, setLocale } = useI18n();
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, { auth_type: string; host_url: string; username: string; token: string; verify_ssl: boolean }>>({});
  const [projectsByConnection, setProjectsByConnection] = useState<Record<number, JiraProject[]>>({});
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<JiraConnection | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newConnection, setNewConnection] = useState({
    auth_type: 'cloud',
    host_url: session.instanceUrl || '',
    username: '',
    token: '',
    verify_ssl: jira.verifySsl
  });
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);
  const profileImportInputRef = useRef<HTMLInputElement | null>(null);
  const editableJiraFields = (session.jiraMetadata?.fields || []).filter((field: JiraField) => !isSystemManagedField(field));
  const activeJiraConnection = session.connections?.find(connection => connection.id === session.jiraConnectionId);
  const readinessChecks = buildJiraReadinessItems(
    session.jiraCapabilityProfile,
    session.xrayFieldDefaults,
    Boolean(activeJiraConnection?.has_xray_cloud_credentials)
  );
  const capabilityReadinessScore = getJiraReadinessScore(readinessChecks) ?? 0;
  const capabilityFeatures = buildCapabilityFeatures(session.jiraCapabilityProfile, Boolean(activeJiraConnection?.has_xray_cloud_credentials));
  const mappedSourceStoryFields = getMappedSourceStoryFields(session.jiraCapabilityProfile);
  const missingXrayRequiredDefaults = getMissingRequiredTargetFieldKeys(session.jiraCapabilityProfile, session.xrayFieldDefaults);
  const targetTestFieldEntries = session.jiraCapabilityProfile
    ? Object.entries(session.jiraCapabilityProfile.targetTestCreateFields.fieldSchemas)
      .filter(([fieldKey]) => !['project', 'issuetype', 'summary', 'description'].includes(fieldKey))
      .map(([key, schema]) => ({ key, schema, required: session.jiraCapabilityProfile?.targetTestCreateFields.requiredFields.includes(key) || false }))
      .sort((a, b) => Number(b.required) - Number(a.required) || a.schema.name.localeCompare(b.schema.name))
    : [];

  const request = (url: string, options: RequestInit = {}) => apiRequest(url, {
    ...options,
    token: authToken,
    onUnauthorized: refreshSession,
  });

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

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveProfile = async (profile: JiraCapabilityProfile, success?: string) => {
    await jiraCapabilityService.save(profile);
    updateSession({ jiraCapabilityProfile: profile, success: success || null });
  };

  const saveXrayDefault = (fieldKey: string, value: unknown) => {
    const isEmptyValue = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    const nextDefaults = { ...(session.xrayFieldDefaults || {}) };
    if (isEmptyValue) {
      delete nextDefaults[fieldKey];
    } else {
      nextDefaults[fieldKey] = value;
    }
    updateSession({ xrayFieldDefaults: nextDefaults });
    if (session.jiraCapabilityProfile) {
      void jiraCapabilityService.saveXrayFieldDefaults(session.jiraCapabilityProfile, nextDefaults).then((profile) => {
        updateSession({ jiraCapabilityProfile: profile });
      });
    }
  };

  const saveSyncStrategy = (updates: Partial<NonNullable<typeof session.jiraCapabilityProfile>['syncStrategy']>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile) return;
    const nextSyncStrategy = { ...profile.syncStrategy, ...updates };
    const updatedProfile = { ...profile, syncStrategy: nextSyncStrategy };
    updateSession({ jiraCapabilityProfile: updatedProfile });
    void jiraCapabilityService.saveSyncStrategy(profile, nextSyncStrategy).then((savedProfile) => {
      updateSession({ jiraCapabilityProfile: savedProfile });
    });
  };

  const saveWorkflowSettings = (updates: Partial<NonNullable<JiraCapabilityProfile['workflow']>>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile?.workflow) return;
    const nextWorkflow = { ...profile.workflow, ...updates };
    const updatedProfile = { ...profile, workflow: nextWorkflow };
    updateSession({ jiraCapabilityProfile: updatedProfile });
    void jiraCapabilityService.saveWorkflowSettings(profile, nextWorkflow).then((savedProfile) => {
      updateSession({ jiraCapabilityProfile: savedProfile });
    });
  };

  const saveSourceStoryMapping = (updates: Partial<JiraCapabilityProfile['sourceStoryMapping']>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile) return;
    const nextMapping = { ...profile.sourceStoryMapping, ...updates };
    const updatedProfile = { ...profile, sourceStoryMapping: nextMapping };
    updateSession({ jiraCapabilityProfile: updatedProfile });
    void jiraCapabilityService.saveSourceStoryMapping(profile, nextMapping).then((savedProfile) => {
      updateSession({ jiraCapabilityProfile: savedProfile });
    });
  };

  const savePrivacySettings = (updates: Partial<NonNullable<JiraCapabilityProfile['privacy']>>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile?.privacy) return;
    const nextPrivacy = { ...profile.privacy, ...updates };
    void saveProfile({ ...profile, privacy: nextPrivacy }, 'Privacy settings saved.');
  };

  const exportCapabilityProfile = () => {
    const profile = session.jiraCapabilityProfile;
    if (!profile) return;
    downloadJson(sanitizeJiraCapabilityProfile(profile), `jira-capability-profile-${profile.selectedProject?.key || 'global'}.json`);
    updateSession({ success: 'Sanitized Jira capability profile exported.' });
  };

  const exportAdminDiagnostic = () => {
    const profile = session.jiraCapabilityProfile;
    if (!profile) return;
    downloadJson(buildAdminDiagnosticReport(profile, readinessChecks), `jira-admin-diagnostic-${profile.selectedProject?.key || 'global'}.json`);
    updateSession({ success: 'Admin diagnostic report exported.' });
  };

  const exportDryRun = () => {
    const projectKey = session.jiraCapabilityProfile?.selectedProject?.key || session.issueData?.key?.split('-')[0] || 'global';
    downloadJson(buildDryRunReport(session.jiraCapabilityProfile, session), `jira-dry-run-${projectKey}.json`);
    updateSession({ success: 'Dry-run report exported.' });
  };

  const importCapabilityProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as JiraCapabilityProfile;
      if (!parsed?.connection || !parsed?.issueTypes) {
        updateSession({ error: 'The selected file is not a Jira capability profile.' });
        return;
      }
      const importedProfile = await jiraCapabilityService.importProfile(parsed);
      updateSession({ jiraCapabilityProfile: importedProfile, success: 'Jira capability profile imported.' });
    } catch {
      updateSession({ error: 'Could not import the Jira capability profile JSON.' });
    }
  };

  const clearCapabilityProfile = async () => {
    await jiraCapabilityService.clear();
    updateSession({
      jiraCapabilityProfile: null,
      xrayFieldDefaults: {},
      xrayWarnings: [],
      success: 'Saved Jira capability profile cleared from this browser.'
    });
  };

  // Auto-refetch when entering Jira tab if empty
  useEffect(() => {
    if (session.settingsTab === 'jira' && session.issueTypes.length === 0 && !session.issueTypesFetched && !session.error && session.instanceUrl && !session.loading) {
      log('SETTINGS-AUTO', 'Mapping tab empty, triggering background sync...');
      refreshIssue(true);
    }
  }, [session.settingsTab, session.issueTypes.length, session.issueTypesFetched, session.error, session.instanceUrl, session.loading, refreshIssue, log]);

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    updateSession({ loading: true });
    try {
      const res = await request(`${apiBase}/workspaces/`, {
        method: 'POST',
        body: JSON.stringify({ name: newWorkspaceName })
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to create workspace');
      if (res.ok) {
        const ws = await readJsonResponse<{ id: number }>(res);
        setNewWorkspaceName('');
        setShowCreateWorkspace(false);
        // Refresh workspaces list in session
        const wsRes = await request(`${apiBase}/workspaces/`);
        if (!wsRes.ok) await throwApiErrorResponse(wsRes, 'Failed to refresh workspaces');
        if (wsRes.ok) {
          const workspaces = await readJsonResponse<typeof session.workspaces>(wsRes);
          updateSession({ workspaces, activeWorkspaceId: ws.id, activeWorkspaceRole: 'owner' });
        }
      }
    } catch (err) {
      console.error('Failed to create workspace', err);
      updateSession({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
    } finally {
      updateSession({ loading: false });
    }
  };

  const handleSwitchWorkspace = async (workspaceId: number) => {
    updateSession({ loading: true });
    try {
      const res = await request(`${apiBase}/workspaces/${workspaceId}/activate`, {
        method: 'POST',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to switch workspace');
      if (res.ok) {
        const ws = session.workspaces.find(w => w.id === workspaceId);
        updateSession({ 
          activeWorkspaceId: workspaceId,
          activeWorkspaceRole: ws?.role || 'viewer' 
        });
        // Force reload jira context for new workspace
        refreshIssue(true);
      }
    } catch (err) {
      console.error('Failed to switch workspace', err);
      updateSession({ error: err instanceof Error ? err.message : 'Failed to switch workspace' });
    } finally {
      updateSession({ loading: false });
    }
  };

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
    const profileProject = getProfileProjectParams(session.jiraCapabilityProfile);
    const projectKey = profileProject.projectKey || session.issueData?.key.split('-')[0];
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
        projectId: profileProject.projectId || session.jiraMetadata?.project_id || session.issueData.projectId,
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
      {connectionToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <SurfaceCard className="w-full max-w-xs p-4 shadow-2xl">
            <h3 className="text-sm font-bold text-[var(--text-main)]">Delete Jira Connection</h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
              Delete the Jira connection for {connectionToDelete.host_url}? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConnectionToDelete(null)}
                className="rounded-lg border border-[var(--border-main)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = connectionToDelete.id;
                  setConnectionToDelete(null);
                  jira.deleteConnection(id);
                }}
                className="rounded-lg bg-red-500 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white"
              >
                Delete
              </button>
            </div>
          </SurfaceCard>
        </div>
      )}

      <SurfaceCard className="flex items-center justify-between gap-3 px-4 py-3.5">
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
      </SurfaceCard>

      <div className="grid grid-cols-5 gap-1.5 rounded-[1.4rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-1.5">
        <button
          onClick={() => updateSession({ settingsTab: 'ai' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'ai' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          AI
        </button>
        <button
          onClick={() => updateSession({ settingsTab: 'jira' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'jira' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Map
        </button>
        <button
          onClick={() => updateSession({ settingsTab: 'capability' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'capability' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Xray
        </button>
        <button
          onClick={() => updateSession({ settingsTab: 'connections' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'connections' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Conns
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'workspaces' })}
          className={`py-2.5 text-[10px] font-bold rounded-[1rem] transition-all tracking-[0.14em] uppercase ${session.settingsTab === 'workspaces' ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
        >
          Teams
        </button>
      </div>


      <SurfaceCard className="space-y-3 px-4 py-3.5">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Appearance</p>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Theme</h3>
          <p className="max-w-[34ch] text-[11px] leading-relaxed text-[var(--text-secondary)]">
            Switch between the refreshed light palette and the new dark surface system.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-1.5">
          <div className="flex items-center gap-2 px-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--primary-blue)]">
              {session.theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </span>
            <div className="leading-tight">
              <div className="text-[11px] font-bold text-[var(--text-primary)]">
                {session.theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Manual override
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateSession({
              theme: session.theme === 'dark' ? 'light' : 'dark',
              themeSource: 'manual'
            })}
            className="flex h-8 min-w-[92px] items-center justify-between rounded-full border border-[var(--card-border)] bg-[var(--bg-elevated)] px-2 text-[10px] font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] hover:bg-[var(--surface-soft-hover)]"
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
              session.theme === 'dark'
                ? 'bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]'
                : 'bg-[var(--surface-accent)] text-[var(--primary-purple)]'
            }`}>
              {session.theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
            </span>
            <span>{session.theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
          <button
            type="button"
            onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            className="flex h-8 min-w-[92px] items-center justify-between rounded-full border border-[var(--card-border)] bg-[var(--bg-elevated)] px-2 text-[10px] font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-active)] hover:bg-[var(--surface-soft-hover)]"
            title="Language / اللغة"
          >
            <Languages size={12} className="text-[var(--primary-blue)]" />
            <span>{locale === 'ar' ? 'العربية' : 'English'}</span>
          </button>
        </div>
      </SurfaceCard>

      {session.settingsTab === 'ai' ? (
        <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500">
          <SurfaceCard className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[var(--primary-blue)] rounded-full animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Platform Settings</span>
            </div>
            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">BugMind API Endpoint</label>
              <input 
                type="url" 
                value={apiBase} 
                onChange={e => setApiBase(e.target.value)}
                onBlur={e => {
                  const val = normalizeApiBaseInput(e.target.value);
                  setApiBase(val);
                  chrome.storage.local.set({ 'bugmind_api_base': val });
                }}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/10 transition-all"
                placeholder="https://api.bugmind.ai/api/v1"
              />
            </div>
          </SurfaceCard>

          <SurfaceCard className="space-y-3 bg-[linear-gradient(180deg,var(--surface-accent-strong),var(--card-surface-bottom))]">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[var(--primary-blue)]" fill="currentColor" />
              <p className="text-[11px] text-[var(--primary-blue)] font-bold tracking-[0.16em] uppercase">Custom AI Credentials</p>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Override BugMind&apos;s default AI with your own OpenRouter credentials. Leave empty to use the platform default.
            </p>
          </SurfaceCard>

          <SurfaceCard>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="space-y-2">
                <label className="context-label uppercase tracking-wider block ml-1">OpenRouter API Key</label>
                <input 
                  type="password" 
                  value={customKey} 
                  onChange={e => {
                    setCustomKey(e.target.value);
                    if (e.target.value.trim()) setClearCustomKeyRequested(false);
                  }}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/10 transition-all"
                  placeholder={hasCustomKeySaved ? "••••••••••••••••" : "sk-or-v1-..."}
                />
                {hasCustomKeySaved && (
                  <div className="flex items-center justify-between gap-2 ml-1 mt-1">
                    <div className="flex items-center gap-1.5">
                      <Check size={12} className="text-[var(--success)]" />
                      <p className="text-[10px] text-[var(--success)] font-bold">
                        {clearCustomKeyRequested ? 'Custom key will be cleared' : 'Custom key active'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClearCustomKeyRequested(true);
                        setCustomKey('');
                      }}
                      className="text-[10px] font-bold text-[var(--status-danger)] hover:underline"
                    >
                      Clear Key
                    </button>
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

              <ActionButton
                type="submit"
                disabled={session.loading}
                variant="primary"
                className="h-11 w-full"
              >
                {session.loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
                {session.loading ? 'Saving...' : 'Save Settings'}
              </ActionButton>
            </form>
          </SurfaceCard>
        </div>
      ) : session.settingsTab === 'capability' ? (
        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
          <input
            ref={profileImportInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importCapabilityProfile}
          />

          {!session.jiraCapabilityProfile ? (
            <StatusPanel
              icon={AlertCircle}
              tone="warning"
              title="No Jira Capability Profile"
              description="Add or refresh a Jira connection to discover permissions, projects, issue types, Xray support, and sync readiness."
              action={(
                <div className="flex gap-2">
                  <ActionButton onClick={() => updateSession({ settingsTab: 'connections' })} variant="secondary" className="h-10 text-[11px]">
                    Manage Connections
                  </ActionButton>
                  <ActionButton onClick={() => profileImportInputRef.current?.click()} variant="secondary" className="h-10 text-[11px]">
                    <Upload size={12} />
                    Import
                  </ActionButton>
                </div>
              )}
            />
          ) : (
            <>
              <SurfaceCard className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Jira Capability Profile</p>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">
                      {session.jiraCapabilityProfile.selectedProject?.key || 'Global'} setup
                    </h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      {session.jiraCapabilityProfile.connection.deploymentType} API v{session.jiraCapabilityProfile.connection.apiVersion} · {session.jiraCapabilityProfile.user.displayName || session.jiraCapabilityProfile.user.emailAddress || 'Connected user'}
                    </p>
                  </div>
                  <StatusBadge tone={capabilityReadinessScore >= 80 ? 'success' : capabilityReadinessScore >= 50 ? 'warning' : 'danger'}>
                    {capabilityReadinessScore}% Ready
                  </StatusBadge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {readinessChecks.map(item => (
                    <div key={item.key} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${item.ok ? 'bg-[var(--status-success)]' : item.blocking ? 'bg-[var(--status-danger)]' : 'bg-[var(--status-warning)]'}`} />
                        <div className="text-[10px] font-bold text-[var(--text-primary)]">{item.label}</div>
                      </div>
                      <div className="mt-1 text-[10px] leading-snug text-[var(--text-muted)]">{item.detail || (item.ok ? 'Available' : 'Needs attention')}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton type="button" onClick={exportCapabilityProfile} variant="secondary" className="h-9 px-3 text-[10px]">
                    <Download size={12} />
                    Profile
                  </ActionButton>
                  <ActionButton type="button" onClick={exportAdminDiagnostic} variant="secondary" className="h-9 px-3 text-[10px]">
                    <ClipboardList size={12} />
                    Admin Report
                  </ActionButton>
                  <ActionButton type="button" onClick={exportDryRun} variant="secondary" className="h-9 px-3 text-[10px]">
                    <Download size={12} />
                    Dry Run
                  </ActionButton>
                  <ActionButton type="button" onClick={() => profileImportInputRef.current?.click()} variant="secondary" className="h-9 px-3 text-[10px]">
                    <Upload size={12} />
                    Import
                  </ActionButton>
                  <ActionButton type="button" onClick={clearCapabilityProfile} variant="ghost" className="h-9 px-3 text-[10px]">
                    Clear
                  </ActionButton>
                </div>
              </SurfaceCard>

              <SurfaceCard className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Project & Xray Target</p>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">Default test destination</h3>
                  </div>
                  <StatusBadge tone={missingXrayRequiredDefaults.length ? 'warning' : 'success'}>
                    {missingXrayRequiredDefaults.length ? `${missingXrayRequiredDefaults.length} Missing` : 'Complete'}
                  </StatusBadge>
                </div>
                <div className="space-y-2">
                  <label className="context-label uppercase tracking-wider block ml-1">Default Project</label>
                  <LuxurySearchableSelect
                    options={session.jiraCapabilityProfile.projects.map(project => ({ id: project.id, name: `${project.key} - ${project.name}` }))}
                    value={session.xrayTargetProjectId ? { id: session.xrayTargetProjectId } : undefined}
                    placeholder="Select target project..."
                    onChange={(next) => {
                      if (!isSelectOption(next) || !session.jiraCapabilityProfile) return;
                      const project = session.jiraCapabilityProfile.projects.find(item => item.id === String(next.id ?? ''));
                      if (!project) return;
                      void saveProfile({
                        ...session.jiraCapabilityProfile,
                        selectedProject: project,
                        privacy: session.jiraCapabilityProfile.privacy ? {
                          ...session.jiraCapabilityProfile.privacy,
                          projectAllowlist: Array.from(new Set([...(session.jiraCapabilityProfile.privacy.projectAllowlist || []), project.key])),
                        } : session.jiraCapabilityProfile.privacy,
                      });
                      updateSession({ xrayTargetProjectId: project.id, xrayTargetProjectKey: project.key });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="context-label uppercase tracking-wider block ml-1">Xray Test Issue Type</label>
                  <LuxurySearchableSelect
                    options={session.jiraCapabilityProfile.issueTypes.all.map(type => ({ id: type.id, name: type.name, avatar: type.icon_url || type.iconUrl }))}
                    value={session.jiraCapabilityProfile.issueTypes.test || undefined}
                    placeholder="Select Test issue type..."
                    onChange={(next) => {
                      if (!isSelectOption(next) || !session.jiraCapabilityProfile) return;
                      const issueType = session.jiraCapabilityProfile.issueTypes.all.find(type => type.id === String(next.id ?? ''));
                      if (!issueType) return;
                      updateSession({ xrayTestIssueTypeName: issueType.name });
                      void jiraCapabilityService.saveTestIssueType(session.jiraCapabilityProfile, issueType).then(profile => {
                        updateSession({ jiraCapabilityProfile: profile });
                      });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-[var(--text-secondary)]">
                  {capabilityFeatures.map(feature => (
                    <div key={feature.key} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-2.5">
                      <div className="font-bold text-[var(--text-primary)]">{feature.label}</div>
                      <div className="mt-1">{feature.detail}</div>
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard className="space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Required Xray Fields</p>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Target create defaults</h3>
                </div>
                {targetTestFieldEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-main)] p-4 text-center text-[11px] text-[var(--text-muted)]">
                    No target create fields were discovered for the selected Test issue type.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {targetTestFieldEntries.map(({ key, schema, required }) => {
                      const savedValue = session.xrayFieldDefaults[key];
                      const label = `${schema.name}${required ? ' *' : ''}`;
                      if (schema.allowedValues?.length) {
                        return (
                          <div key={key} className="space-y-1.5">
                            <label className="context-label uppercase tracking-wider block ml-1">{label}</label>
                            <LuxurySearchableSelect
                              options={schema.allowedValues.map(option => ({ id: option.id || option.value || option.name, name: option.name || option.value || option.id }))}
                              value={typeof savedValue === 'object' && savedValue !== null ? savedValue as SelectOption : undefined}
                              placeholder="Select default value..."
                              onChange={(next) => {
                                if (!isSelectOption(next)) return;
                                saveXrayDefault(key, { id: String(next.id ?? ''), name: next.name });
                              }}
                            />
                          </div>
                        );
                      }
                      if (schema.type === 'boolean') {
                        return (
                          <label key={key} className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5 text-[11px]">
                            <span className="font-bold text-[var(--text-primary)]">{label}</span>
                            <input type="checkbox" checked={Boolean(savedValue)} onChange={(event) => saveXrayDefault(key, event.target.checked)} />
                          </label>
                        );
                      }
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="context-label uppercase tracking-wider block ml-1">{label}</label>
                          <input
                            type={schema.type === 'number' ? 'number' : schema.type === 'date' ? 'date' : 'text'}
                            value={savedValue == null || typeof savedValue === 'object' ? '' : String(savedValue)}
                            onChange={(event) => saveXrayDefault(key, schema.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
                            className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3.5 py-2.5 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--primary-blue)]"
                            placeholder={`Default ${schema.name}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </SurfaceCard>

              <SurfaceCard className="space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Sync Strategy</p>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Publish behavior</h3>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { key: 'createInSourceProject', label: 'Create tests in source project' },
                    { key: 'inheritLabels', label: 'Inherit labels from source story' },
                    { key: 'inheritComponents', label: 'Inherit components from source story' },
                    { key: 'inheritVersions', label: 'Inherit fix versions from source story' },
                    { key: 'transitionAfterCreate', label: 'Transition Test after creation' },
                  ].map(item => (
                    <label key={item.key} className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5 text-[11px]">
                      <span className="font-bold text-[var(--text-primary)]">{item.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(session.jiraCapabilityProfile?.syncStrategy[item.key as keyof typeof session.jiraCapabilityProfile.syncStrategy])}
                        onChange={(event) => saveSyncStrategy({ [item.key]: event.target.checked } as Partial<NonNullable<typeof session.jiraCapabilityProfile>['syncStrategy']>)}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="context-label uppercase tracking-wider block ml-1">Fallback Mode</label>
                    <select
                      value={session.jiraCapabilityProfile.syncStrategy.fallbackWhenNativeStepsFail}
                      onChange={(event) => saveSyncStrategy({ fallbackWhenNativeStepsFail: event.target.value as 'manualStepsField' | 'description' })}
                      className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3 py-2.5 text-[11px] text-[var(--text-primary)]"
                    >
                      <option value="manualStepsField">Manual Steps Field</option>
                      <option value="description">Description</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="context-label uppercase tracking-wider block ml-1">Workflow Mode</label>
                    <select
                      value={session.jiraCapabilityProfile.workflow?.mode || 'sync_enabled'}
                      onChange={(event) => saveWorkflowSettings({ mode: event.target.value as NonNullable<JiraCapabilityProfile['workflow']>['mode'] })}
                      className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3 py-2.5 text-[11px] text-[var(--text-primary)]"
                    >
                      <option value="generate_only">Generate only</option>
                      <option value="sync_enabled">Sync enabled</option>
                      <option value="admin_diagnostic">Admin diagnostic</option>
                      <option value="safe_mode">Safe mode</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5 text-[11px]">
                  <span className="font-bold text-[var(--text-primary)]">Add comment to source story after sync</span>
                  <input
                    type="checkbox"
                    checked={Boolean(session.jiraCapabilityProfile.workflow?.addCommentAfterSync)}
                    onChange={(event) => saveWorkflowSettings({ addCommentAfterSync: event.target.checked })}
                  />
                </label>
                <div className="space-y-1.5">
                  <label className="context-label uppercase tracking-wider block ml-1">Default Folder</label>
                  <input
                    type="text"
                    value={session.jiraCapabilityProfile.workflow?.defaultFolderByProject?.[session.jiraCapabilityProfile.selectedProject?.key || ''] || ''}
                    onChange={(event) => {
                      const projectKey = session.jiraCapabilityProfile?.selectedProject?.key || 'GLOBAL';
                      saveWorkflowSettings({
                        defaultFolderByProject: {
                          ...(session.jiraCapabilityProfile?.workflow?.defaultFolderByProject || {}),
                          [projectKey]: event.target.value,
                        },
                      });
                      updateSession({ xrayFolderPath: event.target.value });
                    }}
                    className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                    placeholder="Xray repository folder path"
                  />
                </div>
              </SurfaceCard>

              <SurfaceCard className="space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Source Story Mapping</p>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Fields sent into generation</h3>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {mappedSourceStoryFields.map(item => (
                    <div key={item.key} className="space-y-1.5">
                      <label className="context-label uppercase tracking-wider block ml-1">{item.label}</label>
                      <input
                        type="text"
                        value={item.fieldId || ''}
                        onChange={(event) => saveSourceStoryMapping({ [item.key]: event.target.value } as Partial<JiraCapabilityProfile['sourceStoryMapping']>)}
                        className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                        placeholder="Jira field id, e.g. customfield_12345"
                      />
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  Confidence score: {session.jiraCapabilityProfile.sourceStoryMapping.confidenceScore ?? 0}%
                </div>
              </SurfaceCard>

              {session.jiraCapabilityProfile.privacy && (
                <SurfaceCard className="space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Security & Privacy</p>
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">AI data controls</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { key: 'maskSensitiveData', label: 'Mask sensitive data before AI' },
                      { key: 'disableCommentsExtraction', label: 'Disable comments extraction' },
                      { key: 'disableAttachmentMetadataExtraction', label: 'Disable attachment metadata extraction' },
                      { key: 'externalAiDisabled', label: 'Disable external AI mode' },
                      { key: 'minimalDataAiMode', label: 'Minimal-data AI mode' },
                    ].map(item => (
                      <label key={item.key} className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5 text-[11px]">
                        <span className="font-bold text-[var(--text-primary)]">{item.label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(session.jiraCapabilityProfile?.privacy?.[item.key as keyof NonNullable<JiraCapabilityProfile['privacy']>])}
                          onChange={(event) => savePrivacySettings({ [item.key]: event.target.checked } as Partial<NonNullable<JiraCapabilityProfile['privacy']>>)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="context-label uppercase tracking-wider block ml-1">Domain Allowlist</label>
                      <input
                        type="text"
                        value={session.jiraCapabilityProfile.privacy.domainAllowlist.join(', ')}
                        onChange={(event) => savePrivacySettings({ domainAllowlist: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
                        className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="context-label uppercase tracking-wider block ml-1">Project Allowlist</label>
                      <input
                        type="text"
                        value={session.jiraCapabilityProfile.privacy.projectAllowlist.join(', ')}
                        onChange={(event) => savePrivacySettings({ projectAllowlist: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
                        className="w-full rounded-2xl border border-[var(--border-main)] bg-[var(--bg-input)] px-3.5 py-2.5 text-[11px] text-[var(--text-main)]"
                      />
                    </div>
                  </div>
                </SurfaceCard>
              )}
            </>
          )}
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
            <SurfaceCard className="p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-3">Add New Connection</div>
              <form
                className="space-y-3"
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
              >

              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Authentication Protocol</div>
                <LuxurySearchableSelect
                  options={[
                    { id: 'cloud', name: 'Atlassian Cloud (API Token)' },
                    { id: 'server', name: 'Jira Data Center (PAT)' }
                  ]}
                  value={{ id: newConnection.auth_type }}
                  onChange={(next) => {
                    if (isSelectOption(next)) {
                      const authType = String(next.id ?? '');
                      if (isConnectionAuthType(authType)) {
                        setNewConnection(prev => ({ ...prev, auth_type: authType }));
                      }
                    }
                  }}
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
              <div className="flex gap-2 pt-2">
                <ActionButton
                  type="submit"
                  disabled={isCreatingConnection}
                  variant="primary"
                  className="flex-[2] h-10 text-[11px]"
                >
                  <Save size={12} className="mr-1.5" />
                  {isCreatingConnection ? 'Saving...' : 'Add New Connection'}
                </ActionButton>
                <ActionButton
                  type="button"
                  onClick={() => setShowAddConnection(false)}
                  variant="secondary"
                  className="flex-1 h-10 text-[11px]"
                >
                  Cancel
                </ActionButton>
              </div>
              </form>
            </SurfaceCard>
          )}

          <div className="space-y-3">
            {(!session.connections || session.connections.length === 0) ? (
              <div className="py-8 text-center bg-[var(--bg-input)] rounded-[1.5rem] border border-dashed border-[var(--border-main)]">
                <p className="text-[11px] text-[var(--text-muted)]">No connections found.</p>
              </div>
            ) : (
              session.connections.map((conn) => (
                <SurfaceCard 
                  key={conn.id} 
                  className={`p-3.5 transition-all ${
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
                        onClick={() => setConnectionToDelete(conn)}
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
                          onChange={(next) => {
                            if (isSelectOption(next)) {
                              const authType = String(next.id ?? '');
                              if (isConnectionAuthType(authType)) {
                                setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], auth_type: authType } }));
                              }
                            }
                          }}
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
                      <div className="flex gap-2 pt-2">
                        <ActionButton
                          type="submit"
                          variant="primary"
                          className="flex-[2] h-10 text-[11px]"
                        >
                          <Save size={12} className="mr-1.5" />
                          Save Connection
                        </ActionButton>
                        <ActionButton
                          type="button"
                          onClick={() => setEditingConnectionId(null)}
                          variant="secondary"
                          className="flex-1 h-10 text-[11px]"
                        >
                          Cancel
                        </ActionButton>
                      </div>
                    </form>
                  )}
                </SurfaceCard>
              ))
            )}
          </div>
        </div>
      ) : session.settingsTab === 'workspaces' ? (
        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
           <SurfaceCard className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-[var(--primary-blue)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Your Teams</span>
              </div>
              <button 
                onClick={() => setShowCreateWorkspace(true)}
                className="text-[10px] font-bold text-[var(--primary-blue)] uppercase flex items-center gap-1 hover:underline"
              >
                <Plus size={12} /> New Team
              </button>
            </div>

            {session.workspaces.length === 0 ? (
              <div className="text-center py-8 px-4 border border-dashed border-[var(--border-main)] rounded-2xl bg-[var(--surface-soft)]/30">
                <Layout size={24} className="mx-auto mb-3 text-[var(--text-muted)] opacity-20" />
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed font-medium">
                  You are currently using BugMind solo.<br/>Create a team workspace to collaborate.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {session.workspaces.map(ws => (
                  <SurfaceCard 
                    key={ws.id} 
                    className={`p-3 cursor-pointer transition-all border ${session.activeWorkspaceId === ws.id ? 'border-[var(--primary-blue)]/30 bg-[var(--surface-accent-soft)]' : 'border-[var(--border-soft)] hover:border-[var(--text-muted)]'}`}
                    onClick={() => handleSwitchWorkspace(ws.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-[1rem] flex items-center justify-center font-bold text-xs ${session.activeWorkspaceId === ws.id ? 'bg-[var(--primary-blue)] text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] border border-[var(--border-soft)]'}`}>
                          {ws.name[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[var(--text-primary)]">{ws.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider opacity-60">Role: {ws.role || 'Member'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {session.activeWorkspaceId === ws.id && <Check size={14} className="text-[var(--primary-blue)]" />}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSession({ view: 'workspace', activeWorkspaceId: ws.id, activeWorkspaceRole: ws.role || 'viewer' });
                          }}
                          className="p-2 hover:bg-[var(--surface-soft)] rounded-xl transition-all text-[var(--text-muted)] hover:text-[var(--primary-blue)] hover:shadow-sm"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  </SurfaceCard>
                ))}
              </div>
            )}
          </SurfaceCard>

          {showCreateWorkspace && (
            <SurfaceCard className="animate-in zoom-in-95 duration-200 border-[var(--primary-blue)]/20 shadow-[0_10px_30px_rgba(59,130,246,0.1)]">
               <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <Plus size={14} className="text-[var(--primary-blue)]" />
                       <h3 className="text-[11px] font-black uppercase text-[var(--text-primary)] tracking-wider">Create Team Workspace</h3>
                    </div>
                    <button onClick={() => setShowCreateWorkspace(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase ml-1 tracking-widest">Workspace Name</label>
                    <input 
                      type="text" 
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)]/30 focus:ring-4 focus:ring-[var(--primary-blue)]/5 transition-all"
                      placeholder="e.g. Acme QA Team"
                      autoFocus
                    />
                  </div>
                  <ActionButton 
                    variant="primary" 
                    className="w-full h-11" 
                    onClick={handleCreateWorkspace} 
                    disabled={!newWorkspaceName.trim() || session.loading}
                  >
                    {session.loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={14} className="mr-2" />}
                    Create Workspace
                  </ActionButton>
               </div>
            </SurfaceCard>
          )}
        </div>
      ) : (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <SurfaceCard className="space-y-4">
            <div className="space-y-1 mb-4">
              <p className="text-[10px] text-[var(--text-muted)] uppercase font-black tracking-[0.18em]">Workflow Defaults</p>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Reporting Issue Types</h3>
            </div>
            
            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">Bug Generation</label>
              <LuxurySearchableSelect 
                options={session.issueTypes.map((type: IssueType) => ({ id: type.id, name: type.name, avatar: type.icon_url }))}
                value={session.defaultBugIssueType || undefined}
                placeholder="Select default issue type..."
                onChange={(type) => {
                  if (type && !Array.isArray(type)) {
                    const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? String(type.id ?? '') : String(type)));
                    if (selectedType) updateSession({ defaultBugIssueType: selectedType });
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">Test Cases</label>
              <LuxurySearchableSelect 
                options={session.issueTypes.map((type: IssueType) => ({ id: type.id, name: type.name, avatar: type.icon_url }))}
                value={session.defaultTestCaseIssueType || undefined}
                placeholder="Select default issue type..."
                onChange={(type) => {
                  if (type && !Array.isArray(type)) {
                    const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? String(type.id ?? '') : String(type)));
                    if (selectedType) updateSession({ defaultTestCaseIssueType: selectedType });
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">AI Gap Analysis</label>
              <LuxurySearchableSelect 
                options={session.issueTypes.map((type: IssueType) => ({ id: type.id, name: type.name, avatar: type.icon_url }))}
                value={session.defaultGapAnalysisIssueType || undefined}
                placeholder="Select default issue type..."
                onChange={(type) => {
                  if (type && !Array.isArray(type)) {
                    const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? String(type.id ?? '') : String(type)));
                    if (selectedType) updateSession({ defaultGapAnalysisIssueType: selectedType });
                  }
                }}
              />
            </div>
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[10px] text-[var(--text-muted)] uppercase font-black tracking-[0.18em]">Project Configuration</p>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">Field Mapping</h3>
              </div>
              <StatusBadge tone="success">Scoped</StatusBadge>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Target project: <strong className="text-[var(--text-main)]">{session.issueData?.key.split('-')[0]}</strong>. Settings are saved per issue type.
            </p>
          </SurfaceCard>

          <SurfaceCard className="space-y-4">
            <div className="space-y-2">
              <label className="context-label uppercase tracking-wider block ml-1">Issue Type</label>
              <LuxurySearchableSelect 
                options={session.issueTypes.map((type: IssueType) => ({ id: type.id, name: type.name, avatar: type.icon_url }))}
                value={session.selectedIssueType}
                placeholder="Select issue type..."
                onChange={(type) => {
                  if (type && !Array.isArray(type) && session.jiraConnectionId && session.issueData) {
                    const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? String(type.id ?? '') : String(type)));
                    if (!selectedType) return;
                    updateSession({ selectedIssueType: selectedType, jiraMetadata: null });
                    void bootstrapJiraConfig(selectedType.id, { force: true, loading: true, logTag: 'SETTINGS-TYPE' });
                  }
                }}
              />
            </div>
          </SurfaceCard>

          {!session.jiraMetadata ? (
              !session.issueData || !session.instanceUrl ? (
                <StatusPanel
                  icon={AlertCircle}
                  tone="warning"
                  title="No Jira Issue Context"
                  description="Open a Jira issue tab, then refresh the page context to configure field mappings."
                  className="animate-in zoom-in duration-500"
                  action={(
                    <ActionButton onClick={() => refreshIssue(true)} variant="secondary" className="h-10 text-[11px]">
                      Refresh Context
                    </ActionButton>
                  )}
                />
              ) : !session.jiraConnectionId ? (
                <StatusPanel
                  icon={AlertCircle}
                  tone="warning"
                  title="No Active Jira Connection"
                  description="Add or activate a Jira connection before configuring project field mappings."
                  className="animate-in zoom-in duration-500"
                  action={(
                    <ActionButton onClick={() => updateSession({ settingsTab: 'connections' })} variant="secondary" className="h-10 text-[11px]">
                      Manage Connections
                    </ActionButton>
                  )}
                />
              ) : session.error?.includes('Jira fields') || session.error?.includes('issue types') ? (
                <StatusPanel
                  icon={AlertCircle}
                  tone="danger"
                  title="Configuration Error"
                  description={session.error}
                  className="animate-in zoom-in duration-500"
                  action={(
                    <ActionButton
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
                      variant="secondary"
                      className="h-10 text-[11px]"
                    >
                      Retry Discovery
                    </ActionButton>
                  )}
                />
              ) : session.issueTypesFetched && session.issueTypes.length === 0 ? (
                <StatusPanel
                  icon={AlertCircle}
                  tone="warning"
                  title="No Issue Types Found"
                  description={(
                    <span>
                      Verify your Jira account has "Browse Projects" permissions for project <strong>{session.issueData?.key.split('-')[0]}</strong>.
                    </span>
                  )}
                  className="animate-in zoom-in duration-500"
                  action={(
                    <ActionButton
                      onClick={() => {
                        const pKey = session.issueData?.key.split('-')[0];
                        if (pKey && session.instanceUrl && session.issueData) {
                          updateSession({ error: null, issueTypesFetched: false });
                          void bootstrapJiraConfig(undefined, { force: true, loading: true, logTag: 'SETTINGS-REFRESH', errorMessage: 'Failed to refresh issue types.' });
                        }
                      }}
                      variant="secondary"
                      className="h-10 text-[11px]"
                    >
                      Refresh Project Config
                    </ActionButton>
                  )}
                />
              ) : (
                <SurfaceCard className="py-12 text-center flex flex-col items-center gap-3 animate-in fade-in duration-700">
                  <Loader2 className="animate-spin text-[var(--status-info)]/60" size={32} />
                  <div className="text-[10px] uppercase tracking-[0.3em] font-black text-[var(--text-muted)] opacity-60">Syncing Schema...</div>
                </SurfaceCard>
              )
            ) : (
              <div className="space-y-6">
                <SurfaceCard className="flex justify-between items-center px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-[var(--status-success)] animate-pulse"></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest opacity-60">Schema Loaded</span>
                      <span className="text-[9px] text-[var(--status-success)] font-black uppercase tracking-tighter">Verified with Jira</span>
                    </div>
                  </div>
                  <ActionButton
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.issueData && session.selectedIssueType) {
                        void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-FORCE', errorMessage: 'Failed to refresh Jira fields.' });
                      }
                    }}
                    variant="secondary"
                    className="w-auto h-9 px-3 text-[10px]"
                  >
                    <RefreshCw size={10} />
                    Force Refresh
                  </ActionButton>
                </SurfaceCard>

                <SurfaceCard className="p-5 space-y-4 border-[var(--border-active)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <HelpCircle size={14} className="text-[var(--status-info)]" />
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--status-info)]">{t('mapping.title')}</div>
                      </div>
                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{t('mapping.help')}</p>
                    </div>
                    <StatusBadge tone={session.mappingWizardCompleted ? 'success' : 'info'}>
                      {session.mappingWizardCompleted ? t('mapping.done') : t('mapping.open')}
                    </StatusBadge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[t('mapping.step1'), t('mapping.step2'), t('mapping.step3'), t('mapping.step4')].map((stepLabel, index) => (
                      <div key={stepLabel} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
                        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Step {index + 1}</div>
                        <div className="text-[11px] font-bold text-[var(--text-primary)]">{stepLabel}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {editableJiraFields.length} Jira fields available
                    </div>
                    <ActionButton
                      type="button"
                      variant="secondary"
                      className="h-9 px-3 text-[10px]"
                      onClick={() => updateSession({ mappingWizardCompleted: true, success: 'Field mapping wizard completed.' })}
                    >
                      <Check size={12} />
                      {t('mapping.done')}
                    </ActionButton>
                  </div>
                </SurfaceCard>

                <SurfaceCard className="p-5 space-y-5 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 bg-[var(--status-info)] rounded-full"></div>
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--status-info)]">Property Intelligence</div>
                        <div className="text-[11px] text-[var(--text-secondary)]">Map AI output to editable Jira fields.</div>
                      </div>
                    </div>
                    <Zap size={14} className="text-[var(--status-info)] opacity-50" />
                  </div>
                  
                  <div className="space-y-4">
                    {[
                      { id: 'steps_to_reproduce', label: 'Steps to Reproduce' },
                      { id: 'expected_result', label: 'Expected Result' },
                      { id: 'actual_result', label: 'Actual Result' },
                      { id: 'priority', label: 'Priority' },
                      { id: 'severity', label: 'Severity' },
                      { id: 'labels', label: 'Labels' }
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
                            onChange={(next) => {
                              if (!isSelectOption(next)) return;
                              const nextMapping = { ...(session.aiMapping || {}), [prop.id]: String(next.id ?? 'description') };
                              saveFieldSettings(undefined, nextMapping);
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </SurfaceCard>

                <div className="space-y-4">
                  <SurfaceCard className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-60 block">Available Fields</label>
                        <div className="text-[11px] text-[var(--text-secondary)]">Choose which Jira fields BugMind should surface and prefill.</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="info">{editableJiraFields.length} Available</StatusBadge>
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
                  </SurfaceCard>
                  <div className="max-h-[550px] overflow-y-auto pr-2 custom-scrollbar space-y-4 pb-12">
                    {editableJiraFields.length === 0 ? (
                      <SurfaceCard className="py-16 text-center border-dashed">
                        <p className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] opacity-50">Discovery in progress or no fields found</p>
                      </SurfaceCard>
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
                            savedDefault={normalizeSavedFieldValue(field, session.fieldDefaults?.[field.key]) as SavedFieldValue}
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

                <SurfaceCard className="p-5 space-y-4 relative overflow-hidden">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 bg-[var(--status-success)] rounded-full"></div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--status-success)]">Protocol Hardening</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Control certificate verification for the active Jira connection.</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between gap-4 bg-[var(--surface-soft)] p-3 rounded-[1.25rem] border border-[var(--border-main)]">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black tracking-tight text-[var(--text-main)]">SSL Certificate Verification</span>
                      <span className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-[0.18em] mt-1">TLS Enforcement</span>
                    </div>
                    <button
                      type="button"
                      aria-pressed={jira.verifySsl}
                      onClick={() => jira.setVerifySsl(!jira.verifySsl)}
                      className={`group inline-flex min-w-[108px] items-center gap-2 rounded-full border px-2 py-1.5 transition-all duration-300 ${
                        jira.verifySsl
                          ? 'justify-end bg-[var(--status-success)]/12 border-[var(--status-success)] text-[var(--status-success)]'
                          : 'justify-start bg-[var(--surface-soft)] border-[var(--border-main)] text-[var(--text-muted)]'
                      }`}
                    >
                      {!jira.verifySsl && (
                        <span className="text-[9px] font-black uppercase tracking-[0.16em]">Off</span>
                      )}
                      <span
                        className={`relative flex h-6 w-11 items-center rounded-full border transition-all duration-300 ${
                          jira.verifySsl
                            ? 'bg-[var(--status-success)] border-[var(--status-success)]'
                            : 'bg-[var(--disabled-bg)] border-[var(--border-main)]'
                        }`}
                      >
                        <span
                          className={`absolute top-1/2 h-4.5 w-4.5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.16)] transition-all duration-300 ${
                            jira.verifySsl ? 'left-[22px]' : 'left-[3px]'
                          }`}
                        />
                      </span>
                      {jira.verifySsl && (
                        <span className="text-[9px] font-black uppercase tracking-[0.16em]">On</span>
                      )}
                    </button>
                  </div>
                  
                  <div className="flex gap-3 px-1">
                    <div className="w-1 bg-[var(--border-main)] rounded-full opacity-30"></div>
                    <p className="text-[10px] text-[var(--text-muted)] opacity-60 leading-relaxed font-medium">
                      Standard protocol for Jira Data Center. Disable only if using self-signed certificates in a controlled environment.
                    </p>
                  </div>
                </SurfaceCard>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default SettingsView;
