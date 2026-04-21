import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check, Plus, Loader2 } from 'lucide-react';

interface Option {
  id: string | number;
  name?: string;
  avatar?: string;
  value?: string;
  label?: string;
}

interface LuxurySearchableSelectProps {
  options: Option[];
  value: any | any[];
  onChange: (value: any) => void;
  isMulti?: boolean;
  placeholder?: string;
  onSearchAsync?: (query: string) => Promise<Option[] | void>;
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
  const [asyncResults, setAsyncResults] = useState<Option[]>([]);
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

  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownHeight = 300;
      if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
        setOpenUp(true);
      } else {
        setOpenUp(false);
      }
    }
  }, [isOpen]);

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

  const currentValues = Array.isArray(value) ? value : (value ? [value] : []);
  
  const resolveValueToOption = (v: any): Option => {
    if (typeof v === 'object' && v !== null) return v;
    const found = options.find(opt => opt.id === v);
    if (found) return found;
    const asyncFound = asyncResults.find(opt => opt.id === v);
    if (asyncFound) return asyncFound;
    return { id: v, name: String(v) };
  };

  const filteredOptions = options.filter(opt => {
    const label = (opt.name || opt.value || opt.label || '').toLowerCase();
    return label.includes(searchQuery.toLowerCase());
  });

  const displayOptions = onSearchAsync && searchQuery.length >= 2 ? asyncResults : filteredOptions;

  const handleToggle = (opt: Option) => {
    if (isMulti) {
      const isSelected = currentValues.some(v => (typeof v === 'object' ? v.id === opt.id : v === opt.id));
      if (isSelected) {
        onChange(currentValues.filter(v => (typeof v === 'object' ? v.id !== opt.id : v !== opt.id)));
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
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between bp-input px-3 py-2 text-bp-mono transition-all ${
          isOpen ? 'border-[var(--bp-main)] bg-[var(--bp-main-muted)]' : 
          (required && currentValues.length === 0 ? 'border-[var(--status-danger)]/40' : 'border-[var(--bp-border-soft)] hover:border-[var(--bp-main)]')
        }`}
      >
        <div className="flex flex-wrap gap-1 items-center flex-1 min-w-0">
          {currentValues.length > 0 ? (
            !isMulti ? (
              (() => {
                const opt = resolveValueToOption(currentValues[0]);
                const avatar = opt.avatar;
                const label = opt.name || opt.value || opt.label || opt.id;
                return (
                  <div className="flex items-center gap-2">
                    {avatar && <img src={avatar} className="w-3.5 h-3.5 rounded-sm" alt="" />}
                    <span className="text-[10px] font-bold text-[var(--bp-text)] uppercase truncate tracking-tight">
                      {label}
                    </span>
                  </div>
                );
              })()
            ) : (
              currentValues.map((v: any, i: number) => {
                const opt = resolveValueToOption(v);
                const label = opt.name || opt.value || opt.label || opt.id;
                return (
                  <div 
                    key={typeof v === 'object' ? (v.id || i) : v} 
                    className="bg-[var(--bp-main)] text-white px-2 py-0.5 text-[8px] font-black uppercase tracking-tight flex items-center gap-1.5"
                  >
                    <span className="truncate max-w-[80px]">{label}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(currentValues.filter((_, idx) => idx !== i));
                      }}
                      className="hover:text-white/70 transition-colors"
                    >
                      <X size={8} />
                    </button>
                  </div>
                );
              })
            )
          ) : (
            <span className="text-[10px] text-[var(--bp-text-muted)] opacity-50 uppercase font-bold">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`text-[var(--bp-main)] opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} size={12} />
      </button>

      {isOpen && (
        <div className={`absolute left-0 w-full bg-[var(--bp-bg)] border border-[var(--bp-border)] z-[1000] flex flex-col max-h-[250px] shadow-2xl ${
          openUp ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          <div className="p-2 border-b border-[var(--bp-border-soft)] bg-[var(--bp-main-muted)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--bp-main)] opacity-50" size={12} />
              <input 
                type="text"
                placeholder="SEARCH_QUERY..."
                autoFocus
                className="w-full bg-transparent border-b border-[var(--bp-border-soft)] pl-8 pr-3 py-1.5 text-[10px] outline-none focus:border-[var(--bp-main)] transition-all font-mono text-[var(--bp-text)] uppercase"
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
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <Loader2 size={10} className="animate-spin text-[var(--bp-main)]" />
                </div>
              )}
            </div>
          </div>
          
          <div className="overflow-y-auto custom-scrollbar flex-1 py-1">
            {displayOptions.length > 0 ? (
              displayOptions.map(opt => {
                const isSelected = currentValues.some(v => (typeof v === 'object' ? v.id === opt.id : v === opt.id));
                return (
                  <button 
                    key={opt.id}
                    onClick={() => handleToggle(opt)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-all group/item border-b border-[var(--bp-border-soft)]/10 last:border-0 ${
                      isSelected ? 'bg-[var(--bp-main-muted)]' : 'hover:bg-[var(--bp-main-muted)]/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {opt.avatar && <img src={opt.avatar} className="w-4 h-4 rounded-sm" alt="" />}
                      <div className="flex flex-col">
                        <span className={`text-[10px] font-bold tracking-tight uppercase font-mono ${isSelected ? 'text-[var(--bp-main)]' : 'text-[var(--bp-text)]'}`}>
                          {opt.name || opt.value || opt.label || opt.id}
                        </span>
                        {opt.id && typeof opt.id === 'string' && opt.id.includes('-') && (
                          <span className="text-[7px] text-[var(--bp-text-muted)] font-bold opacity-40 uppercase tracking-tighter">ID: {opt.id}</span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check size={10} className="text-[var(--bp-main)]" />}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center opacity-30">
                <p className="text-[8px] font-black uppercase tracking-widest font-mono">NO_RESULTS_FOUND</p>
              </div>
            )}
            
            {allowCustomValues && searchQuery.trim() && !displayOptions.some(o => (o.name || o.value || o.label || '').toLowerCase() === searchQuery.toLowerCase()) && (
              <button 
                onClick={handleAddCustom}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bp-main-muted)] text-left transition-all border-t border-[var(--bp-border-soft)]/20 mt-1"
              >
                <div className="p-1 bg-[var(--bp-main-muted)] border border-[var(--bp-border-soft)] text-[var(--bp-main)]">
                  <Plus size={10} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-[var(--bp-text)] uppercase font-mono">Add custom asset</span>
                  <span className="text-[7px] text-[var(--bp-main)] font-bold uppercase tracking-tight font-mono">"{searchQuery.trim()}"</span>
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
