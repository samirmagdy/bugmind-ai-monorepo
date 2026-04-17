import React, { useEffect, useMemo } from 'react';
import { useBugMind } from '../../context/BugMindContext';
import { 
  Plus, MessageSquare, ChevronDown, 
  Loader2, User, Search, X, Save, Send, AlertCircle, Zap, RefreshCw,
  Compass, ArrowRight, Check
} from 'lucide-react';
import { BugReport, JiraField } from '../../types';
import AutoResizeTextarea from '../common/AutoResizeTextarea';
import { TIMEOUTS } from '../../constants';

const MainView: React.FC = () => {
  const { 
    session, updateSession, refreshIssue, debug, handleTabReload,
    ai: { generateBugs, handleManualGenerate, handleUpdateBug, submitBugs, searchUsers } 
  } = useBugMind();

  // Derived search state to prevent redundant effect triggers on unrelated bug edits
  const searchState = useMemo(() => (session.bugs || []).map((b: BugReport) => ({
    q: b.userSearchQuery,
    f: b.activeUserSearchField,
    s: b.isSearchingUsers,
    r: b.userSearchResults?.length || 0
  })), [session.bugs]);

  // Trigger user search when query changes with 400ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      (session.bugs || []).forEach((bug: BugReport, idx: number) => {
        const q = bug.userSearchQuery || '';
        // Only trigger search if query is 2+ chars, we're not already searching, and it's a NEW query
        if (q.length >= 2 && bug.activeUserSearchField && !bug.isSearchingUsers && q !== bug.lastSearchedQuery) {
          if (session.instanceUrl) {
            const pKey = session.issueData?.key.split('-')[0];
            const logTag = `SEARCH-${idx}`;
            debug.log(logTag, `Debounce passed. Searching for "${q}"...`);
            searchUsers(
              q, 
              session.instanceUrl, 
              session.issueData?.projectId, 
              pKey, 
              idx
            );
          }
        }
      });
    }, TIMEOUTS.USER_SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [searchState, session.instanceUrl, session.issueData?.key, debug.log]); // Precise dependencies

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Issue Context Card */}
      <section className={`bg-[var(--bg-card)] border border-[var(--border-main)] shadow-[var(--shadow-md)] p-5 rounded-[2rem] relative group overflow-hidden transition-[box-shadow,background-color,border-color,transform] duration-500 hover:shadow-2xl hover:shadow-[var(--status-info)]/5 ${session.loading ? 'animate-discovery' : ''}`}>
        <div className="absolute top-0 right-0 p-3">
          <button 
            onClick={() => refreshIssue()} 
            title="Refresh Context"
            className={`p-2 text-[var(--text-muted)] hover:text-[var(--status-info)] transition-all bg-[var(--bg-app)]/50 hover:bg-[var(--bg-app)] rounded-full border border-[var(--border-main)] shadow-sm hover:rotate-180 duration-500 ${session.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCw size={14} className={session.loading ? 'animate-spin' : ''} /> 
          </button>
        </div>
        
        <div className="flex items-center gap-2 mb-4">
          <div className={`h-1.5 w-1.5 rounded-full ${session.loading ? 'bg-[var(--status-info)] animate-pulse' : 'bg-[var(--status-success)]'}`}></div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--status-info)]/70">
            {session.loading ? 'Scanning Context...' : 'Jira Context'}
          </h2>
        </div>

        {session.issueData ? (
          <div className="space-y-2 animate-in slide-in-from-left-4 duration-500">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded-md border border-blue-500/20">{session.issueData.key}</span>
              <div className="h-px flex-1 bg-[var(--border-main)]"></div>
            </div>
            <div className="text-base font-bold text-[var(--text-main)] leading-tight pr-8">{session.issueData.summary}</div>
          </div>
        ) : session.error === 'STALE_PAGE' ? (
          <div className="flex flex-col gap-3 py-1 animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-[var(--status-warning)] font-bold text-xs uppercase tracking-tight">
              <AlertCircle size={14} />
              Connection Restrict
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              The bridge to Jira was reset during an update. Please refresh the page to reconnect.
            </p>
            <button 
              onClick={() => handleTabReload()} 
              className="w-full bg-[var(--status-warning)]/10 hover:bg-[var(--status-warning)]/20 border border-[var(--status-warning)]/30 text-[var(--status-warning)] text-[10px] font-black py-3 rounded-2xl transition-all uppercase tracking-widest"
            >
              Refresh Jira Page
            </button>
          </div>
        ) : session.error === 'NOT_A_JIRA_PAGE' ? (
          <div className="flex flex-col gap-4 py-1 animate-in fade-in duration-300">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--bg-input)] rounded-2xl flex items-center justify-center text-[var(--status-info)]/50 border border-[var(--border-main)] shadow-inner shrink-0">
                <Compass size={20} />
              </div>
              <div className="space-y-0.5">
                <h4 className="text-sm font-bold text-[var(--text-main)]">Awaiting Context</h4>
                <p className="text-[10px] text-[var(--text-muted)] leading-tight">Ready to analyze when you land on a ticket.</p>
              </div>
            </div>
            
            <div className="bg-[var(--bg-app)]/50 rounded-2xl p-4 border border-[var(--border-main)] space-y-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] block">Quick Start Guide</span>
              <div className="space-y-2">
                {[
                  { step: "1", text: "Open any Jira Cloud or Server issue tab" },
                  { step: "2", text: "Wait for the sidebar to identify the Story" },
                  { step: "3", text: "Click 'Analyze' to find potential bugs" }
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-4 h-4 rounded bg-[var(--status-info)]/10 text-[var(--status-info)] text-[9px] font-black flex items-center justify-center shrink-0 border border-[var(--status-info)]/20">{item.step}</span>
                    <span className="text-[10px] text-[var(--text-muted)] leading-tight">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <button 
              onClick={() => window.open('https://atlassian.net', '_blank')}
              className="w-full bg-[var(--status-info)]/10 hover:bg-[var(--status-info)]/20 border border-[var(--status-info)]/30 text-[var(--status-info)] text-[10px] font-black py-3 rounded-2xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 group"
            >
              Open Jira 
              <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-4 animate-in fade-in duration-300">
            <div className="relative">
              <Loader2 className="animate-spin text-[var(--status-info)]/50" size={32} />
              <Search className="absolute inset-0 m-auto text-[var(--status-info)]" size={14} />
            </div>
            <div className="text-center">
              <span className="text-xs font-medium text-[var(--text-muted)]">Hunting for Jira context...</span>
              <div className="flex gap-2 justify-center mt-2">
                 <button onClick={() => refreshIssue()} className="text-[10px] font-bold text-blue-500 hover:underline">Retry Scan</button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Action/List Section */}
      {session.error === 'NOT_A_JIRA_PAGE' ? null : (
        <div className="relative">
          {/* Locked State Overlay */}
          {session.error === 'UNSUPPORTED_ISSUE_TYPE' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-12 p-6 animate-in fade-in zoom-in slide-in-from-top-4 duration-700">
              <div className="glass-panel rounded-[2rem] p-6 shadow-2xl border-[var(--status-warning)]/20 space-y-5 text-center max-w-[300px] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-warning)]/40 to-transparent"></div>
                <div className="w-14 h-14 bg-[var(--status-warning)]/10 rounded-2xl flex items-center justify-center text-[var(--status-warning)] mx-auto shadow-inner border border-[var(--status-warning)]/10">
                  <AlertCircle size={28} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-base font-black text-[var(--text-main)] tracking-tight">Requirement Focus</h4>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-2">
                    BugMind is designed for **User Stories**. 
                    This issue is identified as a <span className="text-[var(--status-warning)] font-black">{(session.issueData as any)?.typeName || 'Other'}</span>.
                  </p>
                </div>
                <button 
                  onClick={() => refreshIssue(true)}
                  className="w-full bg-[var(--text-main)] text-[var(--bg-app)] text-[10px] font-black py-4 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <RefreshCw size={12} />
                  Re-Scan Issue
                </button>
              </div>
            </div>
          )}

          <div className={`transition-all duration-700 ${session.error === 'UNSUPPORTED_ISSUE_TYPE' ? 'blur-md grayscale opacity-30 pointer-events-none pt-4' : ''}`}>
            {(!session.bugs || session.bugs.length === 0) ? (
        <div className="py-12 text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-[var(--status-info)]/20 blur-3xl rounded-full animate-pulse"></div>
            <div className="relative bg-[var(--bg-card)] border border-[var(--border-main)] w-24 h-24 rounded-[2.5rem] flex items-center justify-center mx-auto text-[var(--status-info)] shadow-2xl backdrop-blur-xl">
              <Zap size={40} fill="currentColor" />
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-black text-[var(--text-main)] tracking-tight">AI Analysis Ready</h3>
            <p className="text-sm text-[var(--text-muted)] px-10 leading-relaxed opacity-90">
              We'll analyze the User Story and Acceptance Criteria to uncover hidden requirements and potential functional bugs.
            </p>
          </div>
          
          <div className="space-y-4 px-2">
            <button 
              onClick={generateBugs}
              disabled={!session.issueData}
              className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-black py-4 rounded-[1.5rem] transition-all shadow-xl shadow-[var(--accent)]/20 flex items-center justify-center gap-3 enabled:hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:grayscale btn-press"
            >
              <Plus size={20} className="stroke-[3px]" />
              Analyze Story with AI
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-[var(--border-main)] opacity-50"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.3em] font-black text-[var(--text-muted)]">
                <span className="bg-[var(--bg-app)] px-3">or</span>
              </div>
            </div>

            {!session.showManualInput ? (
              <button 
                onClick={() => updateSession({ showManualInput: true })}
                className="w-full bg-[var(--bg-card)] hover:bg-[var(--bg-app)] border border-[var(--border-main)] text-[var(--text-main)] font-bold py-4 rounded-[1.2rem] shadow-[var(--shadow-sm)] transition-all flex items-center justify-center gap-2"
              >
                <MessageSquare size={16} />
                Manually Describe Bug
              </button>
            ) : (
              <div className="bg-[var(--bg-card)] border border-[var(--border-main)] p-5 rounded-[1.5rem] space-y-4 animate-in fade-in slide-in-from-top-4 duration-500 shadow-[var(--shadow-md)]">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--status-info)]">Manual Input</span>
                  <button onClick={() => updateSession({ showManualInput: false })} className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1">
                    <Plus size={16} className="rotate-45" />
                  </button>
                </div>
                <textarea 
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-2xl p-4 text-xs text-[var(--text-main)] outline-none focus:border-[var(--status-info)] transition-all min-h-[100px] shadow-inner placeholder:text-[var(--text-muted)]"
                  placeholder="e.g. Describe the behavior you observed..."
                  value={session.manualDesc}
                  onChange={e => updateSession({ manualDesc: e.target.value })}
                />
                <button 
                  onClick={handleManualGenerate}
                  disabled={!session.manualDesc.trim()}
                  className="w-full bg-[var(--status-info)]/10 hover:bg-[var(--status-info)]/20 border border-[var(--status-info)]/20 text-[var(--status-info)] text-xs font-black py-3 rounded-xl transition-all disabled:opacity-50 uppercase tracking-widest"
                >
                  Structure with AI
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-end mb-2">
            <h3 className="text-lg font-bold text-[var(--text-main)] leading-none">{(session.bugs || []).length} Findings</h3>
            <div className="flex gap-4">
              <button 
                onClick={() => updateSession({ bugs: [], error: null })} 
                className="text-[11px] font-bold text-[var(--status-danger)]/70 hover:text-[var(--status-danger)] uppercase tracking-wider"
              >
                Clear
              </button>
              <button 
                onClick={generateBugs} 
                className="text-[11px] font-bold text-[var(--status-info)] hover:text-[var(--status-info)]/80 uppercase tracking-wider"
              >
                Regenerate
              </button>
            </div>
          </div>
          
          <div className="space-y-3">
            {(session.bugs || []).map((bug: BugReport, idx: number) => (
              <div key={idx} className={`bg-[var(--bg-card)] border rounded-2xl transition-[border-color,box-shadow,background-color,transform] duration-300 shadow-[var(--shadow-sm)] card-hover animate-slide-up stagger-${(idx % 5) + 1} ${session.expandedBug === idx ? 'border-[var(--status-info)]/50 ring-1 ring-[var(--status-info)]/20 shadow-[var(--shadow-md)]' : 'border-[var(--border-main)] hover:border-[var(--status-info)]/30'}`}>
                <button 
                  onClick={() => updateSession({ expandedBug: session.expandedBug === idx ? null : idx })}
                  className="w-full p-4 flex items-start gap-3 text-left btn-press"
                >
                  <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                    bug.severity === 'Critical' ? 'bg-[var(--status-danger)] shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 
                    bug.severity === 'High' ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-info)]'
                  }`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-main)] line-clamp-2 leading-tight">{bug.summary}</div>
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase mt-1 tracking-wider">{bug.severity} Severity</div>
                  </div>
                  <div className={`transition-transform duration-500 ${session.expandedBug === idx ? 'rotate-180' : ''}`}>
                    <ChevronDown size={18} className="text-[var(--text-muted)]" />
                  </div>
                </button>
                
                <div className={`collapsible-grid ${session.expandedBug === idx ? 'expanded' : ''}`}>
                  <div className="collapsible-content">
                    <div className="px-4 pb-4 pt-0 space-y-4">
                      <div className="h-px bg-[var(--border-main)]"></div>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest opacity-80">Description</span>
                          <AutoResizeTextarea 
                            value={bug.description}
                            onChange={e => handleUpdateBug(idx, { description: e.target.value })}
                            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg p-2 text-xs text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-info)] transition-shadow focus:ring-1 focus:ring-[var(--status-info)]/20 placeholder:text-[var(--text-muted)] placeholder:opacity-40"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-80 text-[var(--status-success)]/90">Steps to Reproduce</span>
                          <AutoResizeTextarea 
                            value={bug.steps_to_reproduce}
                            onChange={e => handleUpdateBug(idx, { steps_to_reproduce: e.target.value })}
                            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg p-2 text-xs text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-success)] transition-shadow focus:ring-1 focus:ring-[var(--status-success)]/10 font-mono placeholder:text-[var(--text-muted)] placeholder:opacity-40"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest opacity-80">Expected Result</span>
                            <AutoResizeTextarea 
                              value={bug.expected_result}
                              onChange={e => handleUpdateBug(idx, { expected_result: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg p-2 text-xs text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-info)]"
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase text-[var(--status-danger)] opacity-80 tracking-widest">Actual Result</span>
                            <AutoResizeTextarea 
                              value={bug.actual_result}
                              onChange={e => handleUpdateBug(idx, { actual_result: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg p-2 text-xs text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-danger)]/50"
                            />
                          </div>
                        </div>
                      </div>

                       {/* Dynamic Jira Fields */}
                       {(session.visibleFields || []).length > 0 && (
                         <div className="pt-2 space-y-4">
                           <div className="h-px bg-[var(--border-main)]"></div>
                           <div className="flex items-center gap-2 mb-1">
                             <div className="h-1 w-1 bg-blue-500 rounded-full"></div>
                             <span className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Jira Project Fields</span>
                           </div>
                           <div className="grid grid-cols-1 gap-4">
                             {(session.visibleFields || []).map((fieldKey: string) => {
                               const field = session.jiraMetadata?.fields.find((f: JiraField) => f.key === fieldKey);
                               if (!field) return null;

                               const isMulti = field.type === 'array' || field.type === 'multi-select';
                               const currentVal = bug.extra_fields?.[fieldKey];

                               return (
                                 <div key={fieldKey} className="space-y-1.5">
                                   <div className="flex justify-between items-center ml-0.5">
                                    <label className="text-[10px] font-bold uppercase tracking-tight text-[var(--text-muted)] opacity-80">
                                       {field.name} {field.required && <span className="text-red-500/80">*</span>}
                                     </label>
                                   </div>
                                   
                                   {(fieldKey === 'assignee' || field.type === 'user' || field.type === 'multi-user') ? (
                                     <div className="relative">
                                       {currentVal ? (
                                         <div className="flex items-center justify-between bg-blue-500/5 border border-blue-500/10 rounded-xl px-3 py-2.5">
                                           <div className="flex items-center gap-2">
                                             {currentVal.avatar ? (
                                               <img src={currentVal.avatar} className="w-5 h-5 rounded-full" alt="" />
                                             ) : (
                                               <div className="w-5 h-5 bg-[var(--bg-input)] rounded-full flex items-center justify-center">
                                                 <User size={12} className="text-[var(--text-muted)]" />
                                               </div>
                                             )}
                                             <span className="text-xs text-[var(--status-info)] dark:text-blue-100 font-medium">{currentVal.name || 'Selected User'}</span>
                                           </div>
                                           <button 
                                             onClick={() => handleUpdateBug(idx, { extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: null } })}
                                             className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                                           >
                                             <X size={14} />
                                           </button>
                                         </div>
                                       ) : (
                                         <div className="relative group">
                                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--status-info)] transition-colors" size={12} />
                                           <input 
                                             type="text"
                                             placeholder={`Search for ${field.name}...`}
                                             className={`w-full bg-[var(--bg-input)] border rounded-xl pl-8 pr-3 py-2.5 outline-none transition-all text-xs placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:ring-1 focus:ring-[var(--status-info)]/20 ${bug.userSearchQuery && bug.activeUserSearchField === fieldKey ? 'border-[var(--status-info)]/30' : 'border-[var(--border-main)] focus:border-[var(--status-info)]/30'}`}
                                             value={bug.activeUserSearchField === fieldKey ? (bug.userSearchQuery || '') : ''}
                                             onChange={e => handleUpdateBug(idx, { 
                                               userSearchQuery: e.target.value,
                                               activeUserSearchField: fieldKey
                                             })}
                                           />
                                           {bug.isSearchingUsers && bug.activeUserSearchField === fieldKey && (
                                             <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                               <Loader2 size={12} className="animate-spin text-[var(--status-info)]/70" />
                                             </div>
                                           )}
                                         </div>
                                       )}

                                       {!currentVal && bug.activeUserSearchField === fieldKey && (bug.userSearchQuery?.length || 0) >= 2 && (
                                         <div className="absolute top-full left-0 w-full mt-1 bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in slide-in-from-top-1 duration-200 divide-y divide-[var(--border-main)]">
                                           {bug.isSearchingUsers ? (
                                             <div className="px-4 py-3 text-center">
                                               <Loader2 size={16} className="animate-spin text-[var(--status-info)] mx-auto mb-1 opacity-50" />
                                               <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-black">Searching Jira...</span>
                                             </div>
                                           ) : (bug.userSearchResults && bug.userSearchResults.length > 0) ? (
                                             bug.userSearchResults.map((u: any) => (
                                               <button 
                                                 key={u.id}
                                                 onClick={() => handleUpdateBug(idx, { 
                                                   extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: { id: u.id, name: u.name, avatar: u.avatar } },
                                                   userSearchQuery: '',
                                                   userSearchResults: [],
                                                   activeUserSearchField: null
                                                 })}
                                                 className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-app)] text-left transition-colors group"
                                               >
                                                 {u.avatar ? (
                                                   <img src={u.avatar} className="w-6 h-6 rounded-full" alt="" />
                                                 ) : (
                                                   <div className="w-6 h-6 bg-[var(--bg-input)] rounded-full flex items-center justify-center">
                                                     <User size={14} className="text-[var(--text-muted)]" />
                                                   </div>
                                                 )}
                                                 <div className="flex flex-col">
                                                   <span className="text-xs text-[var(--text-main)] font-medium group-hover:text-[var(--status-info)] transition-colors">{u.name}</span>
                                                   <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-tight font-bold">{u.id}</span>
                                                 </div>
                                               </button>
                                             ))
                                           ) : bug.userSearchResults && bug.userSearchQuery && bug.userSearchQuery.length >= 2 ? (
                                             <div className="px-4 py-4 text-center">
                                               <User size={20} className="mx-auto mb-2 text-[var(--text-muted)] opacity-30" />
                                               <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-black">No users found</span>
                                               <p className="text-[9px] text-[var(--text-muted)] opacity-60 mt-1 lowercase italic">try a different search term</p>
                                             </div>
                                           ) : null}
                                         </div>
                                       )}
                                     </div>
                                   ) : field.allowed_values ? (
                                     <div className="space-y-2">
                                       <select 
                                         value={isMulti ? '' : (currentVal?.id || '')}
                                         onChange={e => {
                                           const valId = e.target.value;
                                           if (!valId) return;
                                           
                                           let nextVal;
                                           if (isMulti) {
                                             const existing = Array.isArray(currentVal) ? currentVal : [];
                                             if (existing.some((v: any) => v.id === valId)) return;
                                             nextVal = [...existing, { id: valId }];
                                           } else {
                                             nextVal = { id: valId };
                                           }
                                           handleUpdateBug(idx, { 
                                             extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: nextVal } 
                                           });
                                         }}
                                         className={`w-full bg-[var(--bg-input)] border rounded-xl px-3 py-2.5 outline-none transition-all text-xs appearance-none cursor-pointer text-[var(--text-main)] ${field.required && (!currentVal || (Array.isArray(currentVal) && currentVal.length === 0)) ? 'border-[var(--status-danger)]/20' : 'border-[var(--border-main)] focus:border-[var(--status-info)]/30'}`}
                                       >
                                         <option value="" className="bg-[var(--bg-card)] text-[var(--text-muted)]">
                                           {isMulti ? `Add ${field.name}...` : `Select ${field.name}...`}
                                         </option>
                                         {field.allowed_values.map((opt: any) => (
                                           <option key={opt.id} value={opt.id} className="bg-[var(--bg-card)] text-[var(--text-main)]">
                                             {opt.name || opt.value || opt.label}
                                           </option>
                                         ))}
                                       </select>

                                       {isMulti && Array.isArray(currentVal) && currentVal.length > 0 && (
                                         <div className="flex flex-wrap gap-1.5">
                                           {currentVal.map((v: any) => {
                                             const opt = field.allowed_values?.find((o: any) => o.id === v.id);
                                             return (
                                               <div key={v.id} className="bg-blue-500/5 border border-blue-500/20 text-blue-400 px-2 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5">
                                                 {opt?.name || opt?.value || opt?.label || v.id}
                                                 <button 
                                                   onClick={() => {
                                                     handleUpdateBug(idx, { 
                                                       extra_fields: { 
                                                         ...(bug.extra_fields || {}), 
                                                         [fieldKey]: currentVal.filter((x: any) => x.id !== v.id) 
                                                       } 
                                                     });
                                                   }}
                                                   className="hover:text-white"
                                                 >
                                                   <Plus size={10} className="rotate-45" />
                                                 </button>
                                               </div>
                                             );
                                           })}
                                         </div>
                                       )}
                                     </div>
                                   ) : field.type === 'labels' ? (
                                     <div className="space-y-2">
                                       <input 
                                         type="text"
                                         placeholder="Type label and press Enter..."
                                         className={`w-full bg-[var(--bg-input)] border rounded-xl px-3 py-2.5 outline-none transition-all text-xs text-[var(--text-main)] border-[var(--border-main)] focus:border-[var(--status-info)]/30 shadow-inner`}
                                         onKeyDown={e => {
                                           if (e.key === 'Enter') {
                                             e.preventDefault();
                                             const val = (e.target as HTMLInputElement).value.trim();
                                             if (!val) return;
                                             const existing = Array.isArray(currentVal) ? currentVal : [];
                                             if (existing.includes(val)) return;
                                             handleUpdateBug(idx, { 
                                               extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: [...existing, val] } 
                                             });
                                             (e.target as HTMLInputElement).value = "";
                                           }
                                         }}
                                       />
                                       {Array.isArray(currentVal) && currentVal.length > 0 && (
                                         <div className="flex flex-wrap gap-1.5">
                                           {currentVal.map((label: string) => (
                                             <div key={label} className="bg-[var(--bg-card)] border border-[var(--border-main)] text-[var(--text-main)] px-2 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5 shadow-sm">
                                               {label}
                                               <button 
                                                 onClick={() => {
                                                   handleUpdateBug(idx, { 
                                                     extra_fields: { 
                                                       ...(bug.extra_fields || {}), 
                                                       [fieldKey]: currentVal.filter((x: string) => x !== label) 
                                                     } 
                                                   });
                                                 }}
                                                 className="hover:text-red-500 transition-colors opacity-60"
                                               >
                                                 <Plus size={10} className="rotate-45" />
                                               </button>
                                             </div>
                                           ))}
                                         </div>
                                       )}
                                     </div>
                                   ) : (
                                     <input 
                                       type="text"
                                       value={currentVal || ''}
                                       onChange={e => handleUpdateBug(idx, { 
                                         extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: e.target.value } 
                                       })}
                                       className={`w-full bg-[var(--bg-input)] border rounded-xl px-3 py-2.5 outline-none transition-all text-xs text-[var(--text-main)] ${field.required && !currentVal ? 'border-[var(--status-danger)]/20' : 'border-[var(--border-main)] focus:border-[var(--status-info)]/30'}`}
                                       placeholder={`Enter ${field.name.toLowerCase()}...`}
                                     />
                                   )}
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                       )}
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                           <div className="text-[10px] text-[var(--text-muted)] italic">Auto-saving edits...</div>
                           {/* Quick indicator pulse on successful update */}
                           <div className="flex items-center gap-1 text-[var(--status-success)] animate-in fade-in zoom-in duration-300">
                             <Check size={10} className="stroke-[3px]" />
                             <span className="text-[9px] font-black uppercase tracking-tighter">Synced</span>
                           </div>
                         </div>
                         <button onClick={() => updateSession({ expandedBug: null })} className="flex items-center gap-2 text-[10px] font-bold text-[var(--status-info)] hover:text-[var(--status-info)]/80">
                           <Save size={12} />
                           Close Editor
                         </button>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button 
            onClick={() => submitBugs()}
            className="w-full bg-[var(--status-success)] hover:brightness-110 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-[var(--status-success)]/20 flex items-center justify-center gap-2 mt-6 btn-press active:scale-[0.98] hover:scale-[1.01]"
          >
            <Send size={18} />
            Push to Jira Project
          </button>
        </div>
      )}
        </div>
      </div>
    )}
    </div>
  );
};

export default MainView;
