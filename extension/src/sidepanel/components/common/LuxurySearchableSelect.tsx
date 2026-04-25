import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check, Plus, Loader2 } from 'lucide-react';

export interface SelectOption {
  id?: string | number;
  name?: string;
  avatar?: string;
  value?: string;
  label?: string;
  icon_url?: string;
  iconUrl?: string;
}

export type SelectValue = SelectOption | string | number | null | undefined;

interface LuxurySearchableSelectProps {
  options: SelectOption[];
  value: SelectValue | SelectValue[];
  onChange: (value: SelectValue | SelectValue[]) => void;
  isMulti?: boolean;
  placeholder?: string;
  onSearchAsync?: (query: string) => Promise<SelectOption[] | void>;
  allowCustomValues?: boolean;
  required?: boolean;
  className?: string;
}

const LuxurySearchableSelect: React.FC<LuxurySearchableSelectProps> = ({
  options = [],
  value,
  onChange,
  isMulti = false,
  placeholder = "Select option...",
  onSearchAsync,
  allowCustomValues = false,
  required = false,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [asyncResults, setAsyncResults] = useState<SelectOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastSearchRef = useRef('');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Smart positioning logic
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownHeight = 350; // max-h-[350px]

      // Flip if not enough space below AND there is more space above
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setOpenUp(true);
      } else {
        setOpenUp(false);
      }
    }
  }, [isOpen]);

  // Async search handler
  useEffect(() => {
    if (!onSearchAsync || searchQuery.length < 2) {
      setAsyncResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (searchQuery !== lastSearchRef.current) {
        setIsSearching(true);
        lastSearchRef.current = searchQuery;
        try {
          const results = await onSearchAsync(searchQuery);
          if (results) setAsyncResults(results);
        } finally {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, onSearchAsync]);

  const currentValues: SelectValue[] = Array.isArray(value) ? value : (value ? [value] : []);
  
  // Helper to resolve a value (object or ID) to a full option for display
  const resolveValueToOption = (v: SelectValue): SelectOption => {
    const findById = (id: string | number | undefined) => {
      if (id === undefined || id === null) return null;
      return options.find(opt => opt.id === id) || asyncResults.find(opt => opt.id === id) || null;
    };

    if (typeof v === 'object' && v !== null) {
      const matched = findById(v.id);
      if (matched) return { ...matched, ...v, avatar: v.avatar || v.icon_url || v.iconUrl || matched.avatar };
      if (v.name || v.value || v.label || v.avatar || v.icon_url || v.iconUrl) return { ...v, avatar: v.avatar || v.icon_url || v.iconUrl };
      return { ...v, name: v.id ? String(v.id) : 'Unknown value' };
    }

    if (v === null || v === undefined) {
      return { name: 'Unknown value' };
    }

    const found = findById(v);
    if (found) return found;
    return { id: v, name: String(v) };
  };

  const filteredOptions = options.filter(opt => {
    const label = (opt.name || opt.value || opt.label || '').toLowerCase();
    return label.includes(searchQuery.toLowerCase());
  });

  const displayOptions = onSearchAsync && searchQuery.length >= 2 ? asyncResults : filteredOptions;

  const handleToggle = (opt: SelectOption) => {
    if (isMulti) {
      const isSelected = currentValues.some(v => (typeof v === 'object' && v !== null ? v.id === opt.id : v === opt.id));
      if (isSelected) {
        onChange(currentValues.filter(v => (typeof v === 'object' && v !== null ? v.id !== opt.id : v !== opt.id)));
      } else {
        onChange([...currentValues, opt]);
      }
    } else {
      onChange(opt);
      setIsOpen(false);
    }
    setSearchQuery('');
  };

  const handleAddCustom = () => {
    if (!allowCustomValues || !searchQuery.trim()) return;
    const val = searchQuery.trim();
    if (isMulti) {
      onChange([...currentValues, val]);
    } else {
      onChange(val);
      setIsOpen(false);
    }
    setSearchQuery('');
  };

  return (
    <div className={`luxury-select relative ${isOpen ? 'luxury-select--open z-[80]' : ''} ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full min-h-[46px] flex items-center justify-between bg-[var(--bg-input)] border rounded-[1rem] px-4 py-2.5 outline-none transition-all duration-300 shadow-inner group/trigger ${
          isOpen ? 'border-[var(--status-info)]/30 ring-4 ring-[var(--status-info)]/5' : 
          (required && currentValues.length === 0 ? 'border-[var(--status-danger)]/20' : 'border-[var(--border-main)] hover:border-[var(--text-muted)]/30')
        }`}
      >
        <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-0">
          {currentValues.length > 0 ? (
            !isMulti ? (
              // Single select display (No bubble)
              (() => {
                const opt = resolveValueToOption(currentValues[0]);
                const avatar = opt.avatar;
                const label = opt.name || opt.value || opt.label || opt.id;
                return (
                  <div className="flex items-center gap-2.5 animate-in fade-in slide-in-from-left-2 duration-300">
                    {avatar && (
                      <img src={avatar} className="w-5 h-5 rounded-md" alt="" />
                    )}
                    <span className="text-[13px] font-semibold text-[var(--text-main)] truncate tracking-tight">
                      {label}
                    </span>
                  </div>
                );
              })()
            ) : (
              // Multi-select display (Bubbles/Tags)
              currentValues.map((v, i: number) => {
                const opt = resolveValueToOption(v);
                const label = opt.name || opt.value || opt.label || opt.id;
                return (
                  <div 
                    key={typeof v === 'object' && v !== null ? (v.id || i) : (v ?? i)} 
                    className="bg-[var(--status-info)]/10 text-[var(--status-info)] px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight flex items-center gap-1.5 border border-[var(--status-info)]/20 animate-in zoom-in-95"
                  >
                    <span className="truncate max-w-[80px]">{label}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(currentValues.filter((_, idx) => idx !== i));
                      }}
                      className="hover:text-[var(--status-danger)] transition-colors opacity-40 hover:opacity-100"
                    >
                      <X size={8} />
                    </button>
                  </div>
                );
              })
            )
          ) : (
            <span className="text-[13px] text-[var(--text-muted)] opacity-50 font-medium">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`text-[var(--text-muted)] opacity-40 transition-transform duration-300 shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} size={16} />
      </button>

      {isOpen && (
        <div className={`absolute left-0 w-full bg-[var(--dropdown-bg)] border border-[var(--dropdown-border)] rounded-[1.1rem] overflow-hidden shadow-none z-[1000] animate-luxury flex flex-col max-h-[280px] ${
          openUp ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}>
          <div className="p-2 border-b border-[var(--dropdown-border)] sticky top-0 bg-[var(--dropdown-bg)] z-10">
            <div className="relative group/search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] opacity-40 group-focus-within/search:text-[var(--status-info)] group-focus-within/search:opacity-100 transition-all" size={12} />
              <input 
                type="text"
                placeholder="Search..."
                autoFocus
                className="w-full bg-[var(--dropdown-bg-muted)] border border-[var(--dropdown-border)] rounded-[0.85rem] pl-8 pr-3 py-2 text-[12px] outline-none focus:border-[var(--status-info)]/30 transition-all font-medium text-[var(--text-main)]"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && allowCustomValues && searchQuery.trim()) {
                    e.preventDefault();
                    handleAddCustom();
                  }
                }}
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 size={10} className="animate-spin text-[var(--status-info)] opacity-50" />
                </div>
              )}
            </div>
          </div>
          
          <div className="overflow-y-auto custom-scrollbar flex-1 py-1 bg-[var(--dropdown-bg)]">
            {displayOptions.length > 0 ? (
              displayOptions.map(opt => {
                const isSelected = currentValues.some(v => (typeof v === 'object' && v !== null ? v.id === opt.id : v === opt.id));
                return (
                  <button 
                    key={opt.id}
                    onClick={() => handleToggle(opt)}
                    className={`w-full min-h-[48px] flex items-center justify-between px-4 py-3 text-left transition-all group/item border-b border-[var(--dropdown-border)] last:border-0 ${
                      isSelected ? 'bg-[var(--status-info)]/10' : 'bg-[var(--dropdown-bg)] hover:bg-[var(--dropdown-bg-muted)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {opt.avatar && (
                        <img src={opt.avatar} className="w-5 h-5 rounded-md ring-2 ring-transparent group-hover/item:ring-[var(--status-info)]/20 transition-all" alt="" />
                      )}
                      <div className="flex flex-col">
                        <span className={`text-[13px] font-semibold tracking-tight transition-colors ${isSelected ? 'text-[var(--status-info)]' : 'text-[var(--text-main)] group-hover/item:text-[var(--status-info)]'}`}>
                          {opt.name || opt.value || opt.label || opt.id}
                        </span>
                        {opt.id && typeof opt.id === 'string' && opt.id.includes('-') && (
                          <span className="text-[7px] text-[var(--text-muted)] font-bold opacity-30 uppercase tracking-tighter">ID: {opt.id}</span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="bg-[var(--status-info)] p-0.5 rounded shadow-[0_0_8px_rgba(59,130,246,0.4)]">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })
            ) : searchQuery.length < 2 && onSearchAsync ? (
              <div className="px-4 py-6 text-center opacity-40">
                <Search size={18} className="mx-auto mb-2" />
                <p className="text-[8px] font-black uppercase tracking-widest">Type 2+ chars to search</p>
              </div>
            ) : (
              <div className="px-4 py-6 text-center opacity-20">
                <Search size={18} className="mx-auto mb-2" />
                <p className="text-[8px] font-black uppercase tracking-widest">No results</p>
              </div>
            )}
            
            {allowCustomValues && searchQuery.trim() && !displayOptions.some(o => (o.name || o.value || o.label || '').toLowerCase() === searchQuery.toLowerCase()) && (
              <button 
                onClick={handleAddCustom}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--status-info)]/5 text-left transition-all group/add border-t border-[var(--border-main)]/20 mt-1"
              >
                <div className="p-1 bg-[var(--status-info)]/10 rounded text-[var(--status-info)] group-hover/add:scale-110 transition-transform">
                  <Plus size={10} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-[var(--text-main)]">Add custom item</span>
                  <span className="text-[8px] text-[var(--status-info)] font-bold uppercase tracking-tight">"{searchQuery.trim()}"</span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LuxurySearchableSelect;
