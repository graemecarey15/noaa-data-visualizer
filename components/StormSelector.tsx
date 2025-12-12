import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Storm } from '../types';
import { getCategoryLabel, INTENSITY_COLORS } from '../constants';

interface PresetOption {
    label: string;
    value: string;
    disabled: boolean;
}

interface StormSelectorProps {
  storms: Storm[];
  selectedIds: Set<string>; 
  onSelect: (id: string) => void; // Focus and Close
  onToggle: (id: string) => void; // Toggle active state (Keep open)
  onSelectBatch: (ids: string[], select: boolean) => void; // Select/Deselect All
  activePreset: string;
  onPresetChange: (preset: string) => void;
  presetOptions: PresetOption[];
  onImport: () => void;
}

const CAT_FILTERS = [
  { label: 'TD', min: 0, max: 33, color: 'border-blue-500 text-blue-400 bg-blue-500/10' },
  { label: 'TS', min: 34, max: 63, color: 'border-emerald-500 text-emerald-400 bg-emerald-500/10' },
  { label: 'C1', min: 64, max: 82, color: 'border-yellow-200 text-yellow-100 bg-yellow-200/10' },
  { label: 'C2', min: 83, max: 95, color: 'border-yellow-500 text-yellow-400 bg-yellow-500/10' },
  { label: 'C3', min: 96, max: 112, color: 'border-orange-500 text-orange-400 bg-orange-500/10' },
  { label: 'C4', min: 113, max: 136, color: 'border-rose-400 text-rose-300 bg-rose-400/10' },
  { label: 'C5', min: 137, max: 999, color: 'border-purple-400 text-purple-300 bg-purple-400/10' },
];

const BASIN_FILTERS = [
  { label: 'ATL', code: 'AL', color: 'border-sky-500 text-sky-400 bg-sky-500/10' },
  { label: 'EPAC', code: 'EP', color: 'border-teal-500 text-teal-400 bg-teal-500/10' },
  { label: 'CPAC', code: 'CP', color: 'border-amber-500 text-amber-400 bg-amber-500/10' },
];

// Types for the flattened virtual list
type RenderItem = 
  | { type: 'year', year: number, count: number, selectedCount: number, ids: string[], isCollapsed: boolean }
  | { type: 'month', label: string, year: number, ids: string[] }
  | { type: 'storm', storm: Storm };

const StormSelector: React.FC<StormSelectorProps> = ({ 
    storms, 
    selectedIds,
    onSelect,
    onToggle,
    onSelectBatch,
    activePreset,
    onPresetChange,
    presetOptions,
    onImport
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [filterBasins, setFilterBasins] = useState<Set<string>>(new Set());
  
  // Collapsed Years State
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const getMonthInfo = (s: Storm) => {
     const d = s.track.length > 0 ? new Date(s.track[0].datetime) : new Date(s.year, 0, 1);
     return {
         index: d.getMonth(),
         name: d.toLocaleString('default', { month: 'long' })
     };
  };

  const getStormMaxWind = (s: Storm) => {
      if (s.track.length === 0) return 0;
      return Math.max(...s.track.map(t => t.maxWind));
  };

  const toggleCategory = (label: string) => {
      const next = new Set(filterCategories);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setFilterCategories(next);
  };

  const toggleBasin = (code: string) => {
      const next = new Set(filterBasins);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      setFilterBasins(next);
  };
  
  const toggleYearCollapse = (year: number) => {
      const next = new Set(collapsedYears);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      setCollapsedYears(next);
  };
  
  const expandAll = () => setCollapsedYears(new Set());
  const collapseAll = (years: number[]) => setCollapsedYears(new Set(years));

  // Filter & SORT Logic
  const filtered = useMemo<Storm[]>(() => {
    let result = storms;
    
    // 1. Search Filter
    if (search) {
        const q = search.toUpperCase();
        result = result.filter(s => 
          s.name.includes(q) || 
          s.id.includes(q) || 
          s.year.toString().includes(q)
        );
    }

    // 2. Basin Filter
    if (filterBasins.size > 0) {
        result = result.filter(s => {
            const basin = s.id.substring(0, 2).toUpperCase();
            return filterBasins.has(basin);
        });
    }

    // 3. Category Filter
    if (filterCategories.size > 0) {
        result = result.filter(s => {
            const wind = getStormMaxWind(s);
            let match = false;
            for (const cat of CAT_FILTERS) {
                if (filterCategories.has(cat.label)) {
                    if (wind >= cat.min && wind <= cat.max) {
                        match = true;
                        break;
                    }
                }
            }
            return match;
        });
    }

    // 4. Strict Sort for Grouping (Year DESC -> Month DESC -> ID DESC)
    return [...result].sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        
        const mA = getMonthInfo(a).index;
        const mB = getMonthInfo(b).index;
        if (mB !== mA) return mB - mA; // Descending Month
        
        return b.id.localeCompare(a.id);
    });
  }, [storms, search, filterCategories, filterBasins]);

  // Flattened List for Rendering (Supports Hierarchy/Collapsing)
  const flatItems = useMemo(() => {
      const items: RenderItem[] = [];
      const yearGroups = new Map<number, Storm[]>();
      
      // Group by Year
      filtered.forEach((s: Storm) => {
          if (!yearGroups.has(s.year)) yearGroups.set(s.year, []);
          yearGroups.get(s.year)!.push(s);
      });

      // Keys come out sorted if we iterate filtered, but let's be safe and use the map
      // Since filtered is sorted by year DESC, we can just iterate the groups in that order
      const uniqueYears = Array.from(new Set(filtered.map((s: Storm) => s.year)));
      
      uniqueYears.forEach((year: number) => {
          const stormsInYear = yearGroups.get(year) || [];
          const idsInYear = stormsInYear.map(s => s.id);
          const selectedCount = idsInYear.filter(id => selectedIds.has(id)).length;
          const isCollapsed = collapsedYears.has(year);

          // Add Year Header
          items.push({
              type: 'year',
              year,
              count: stormsInYear.length,
              selectedCount,
              ids: idsInYear,
              isCollapsed
          });

          if (!isCollapsed) {
              let currentMonth = '';
              stormsInYear.forEach(s => {
                  const mInfo = getMonthInfo(s);
                  // Add Month Header if changed
                  if (mInfo.name !== currentMonth) {
                      const monthStorms = stormsInYear.filter(st => getMonthInfo(st).name === mInfo.name);
                      const monthIds = monthStorms.map(st => st.id);
                      items.push({
                          type: 'month',
                          label: mInfo.name,
                          year: s.year,
                          ids: monthIds
                      });
                      currentMonth = mInfo.name;
                  }
                  
                  // Add Storm Item
                  items.push({ type: 'storm', storm: s });
              });
          }
      });
      
      return items;
  }, [filtered, collapsedYears, selectedIds]);


  // Faceted Counts
  const basinCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      BASIN_FILTERS.forEach(b => counts[b.code] = 0);
      let base = storms;
      if (search) {
          const q = search.toUpperCase();
          base = base.filter(s => s.name.includes(q) || s.id.includes(q) || s.year.toString().includes(q));
      }
      if (filterCategories.size > 0) {
          base = base.filter(s => {
             const wind = getStormMaxWind(s);
             return CAT_FILTERS.some(cat => filterCategories.has(cat.label) && wind >= cat.min && wind <= cat.max);
          });
      }
      base.forEach(s => {
          const code = s.id.substring(0, 2).toUpperCase();
          if (counts[code] !== undefined) counts[code]++;
      });
      return counts;
  }, [storms, search, filterCategories]);

  const categoryCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      CAT_FILTERS.forEach(c => counts[c.label] = 0);
      let base = storms;
      if (search) {
          const q = search.toUpperCase();
          base = base.filter(s => s.name.includes(q) || s.id.includes(q) || s.year.toString().includes(q));
      }
      if (filterBasins.size > 0) {
          base = base.filter(s => filterBasins.has(s.id.substring(0, 2).toUpperCase()));
      }
      base.forEach(s => {
          const wind = getStormMaxWind(s);
          const cat = CAT_FILTERS.find(c => wind >= c.min && wind <= c.max);
          if (cat) counts[cat.label]++;
      });
      return counts;
  }, [storms, search, filterBasins]);

  // Effects
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
      // Reset Highlight when list changes significantly or opens
      setHighlightedIndex(0);
    } else {
      document.body.style.overflow = '';
      setSearch('');
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, flatItems.length - 1));
        // Simple scroll into view
        itemRefs.current[Math.min(highlightedIndex + 1, flatItems.length - 1)]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        itemRefs.current[Math.max(highlightedIndex - 1, 0)]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowRight') {
         // Expand if on collapsed year header
         const item = flatItems[highlightedIndex];
         if (item && item.type === 'year' && item.isCollapsed) {
             e.preventDefault();
             toggleYearCollapse(item.year);
         }
      } else if (e.key === 'ArrowLeft') {
         // Collapse if on expanded year header
         const item = flatItems[highlightedIndex];
         if (item && item.type === 'year' && !item.isCollapsed) {
             e.preventDefault();
             toggleYearCollapse(item.year);
         }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[highlightedIndex];
        if (item) {
            if (item.type === 'storm') {
                if (e.metaKey || e.ctrlKey) {
                    onToggle(item.storm.id);
                } else {
                    onSelect(item.storm.id);
                    setIsOpen(false);
                }
            } else if (item.type === 'year') {
                toggleYearCollapse(item.year);
            }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, flatItems, onSelect, onToggle]); 

  // Reset highlight when list structure changes
  useEffect(() => {
      setHighlightedIndex(0);
  }, [flatItems.length]);


  const getIntensityColor = (storm: Storm) => {
      const maxWind = getStormMaxWind(storm);
      if (maxWind >= 137) return INTENSITY_COLORS.CAT5;
      if (maxWind >= 113) return INTENSITY_COLORS.CAT4;
      if (maxWind >= 96) return INTENSITY_COLORS.CAT3;
      if (maxWind >= 83) return INTENSITY_COLORS.CAT2;
      if (maxWind >= 64) return INTENSITY_COLORS.CAT1;
      if (maxWind >= 34) return INTENSITY_COLORS.TS;
      return INTENSITY_COLORS.TD;
  };

  const getIntensityText = (storm: Storm) => {
      const maxWind = getStormMaxWind(storm);
      return getCategoryLabel(maxWind).replace('Category ', 'C');
  };

  const activeLabel = presetOptions.find(p => p.value === activePreset)?.label || 'current scope';

  const activeCount = selectedIds.size;
  const hasActiveFilters = filterCategories.size > 0 || filterBasins.size > 0;
  
  // Selection Logic Helpers
  const areAllFilteredSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));
  const toggleSelectAllFiltered = () => {
      const ids = filtered.map(s => s.id);
      onSelectBatch(ids, !areAllFilteredSelected);
      inputRef.current?.focus();
  };

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="relative w-full sm:w-64 lg:w-80 bg-slate-950 border border-slate-700 hover:border-slate-600 rounded-lg px-3 py-2 text-left flex items-center shadow-sm group transition-all"
      >
        <svg className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 mr-2 transition-colors" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <div className="flex-1 truncate">
            {activeCount > 0 ? (
                <span className="text-slate-200 text-sm font-medium">
                    {activeCount === 1 ? '1 Selected' : `${activeCount} Selected`}
                </span>
            ) : (
                <span className="text-slate-500 text-sm">Select storm...</span>
            )}
        </div>
        <div className="ml-2 hidden sm:flex items-center gap-1">
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded shadow-sm">⌘K</kbd>
        </div>
      </button>

      {/* Modal Portal */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
           {/* Backdrop */}
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsOpen(false)} />
           
           {/* Modal Content */}
           <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-fade-in ring-1 ring-white/10">
              
              {/* Search Bar */}
              <div className="flex items-center px-4 py-3 bg-slate-900/50">
                 <svg className="h-5 w-5 text-cyan-500 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                 </svg>
                 <input 
                    ref={inputRef}
                    type="text"
                    className="flex-1 bg-transparent border-none outline-none text-slate-200 placeholder-slate-500 text-base h-8"
                    placeholder="Search storms by name, year, or ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                 />
                 <button onClick={() => setIsOpen(false)} className="ml-2 text-xs text-slate-500 hover:text-white px-2 py-1 rounded bg-slate-800 border border-slate-700">ESC</button>
              </div>

              {/* Scope Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-950 border-b border-slate-800 overflow-x-auto scrollbar-hide">
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1 shrink-0">Scope:</span>
                 {presetOptions.map(option => (
                    <button
                        key={option.value}
                        onClick={() => onPresetChange(option.value)}
                        disabled={option.disabled}
                        className={`
                           px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all whitespace-nowrap
                           ${activePreset === option.value 
                               ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50' 
                               : option.disabled
                                  ? 'bg-slate-900 text-slate-700 border-slate-800 cursor-not-allowed'
                                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500'
                           }
                        `}
                    >
                        {option.label}
                    </button>
                 ))}
              </div>

              {/* Combined Filter Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/50 border-b border-slate-800 overflow-x-auto scrollbar-hide">
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1 shrink-0">Filter:</span>
                 
                 {/* BASINS */}
                 <div className="flex items-center gap-1.5 border-r border-slate-700 pr-2 mr-1">
                    {BASIN_FILTERS.map(basin => {
                        const isActive = filterBasins.has(basin.code);
                        const count = basinCounts[basin.code] || 0;
                        return (
                            <button
                                key={basin.code}
                                onClick={() => toggleBasin(basin.code)}
                                className={`
                                    px-2 py-0.5 text-[10px] font-bold rounded border transition-all whitespace-nowrap flex items-center gap-1
                                    ${isActive 
                                        ? basin.color 
                                        : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300'
                                    }
                                    ${count === 0 && !isActive ? 'opacity-40 cursor-default' : ''}
                                `}
                            >
                                {basin.label}
                                <span className={`text-[9px] font-normal ${isActive ? 'opacity-80' : 'opacity-50'}`}>({count})</span>
                            </button>
                        );
                    })}
                 </div>

                 {/* CATEGORIES */}
                 {CAT_FILTERS.map(cat => {
                    const isActive = filterCategories.has(cat.label);
                    const count = categoryCounts[cat.label] || 0;
                    return (
                        <button
                            key={cat.label}
                            onClick={() => toggleCategory(cat.label)}
                            className={`
                                px-2 py-0.5 text-[10px] font-bold rounded border transition-all whitespace-nowrap flex items-center gap-1
                                ${isActive 
                                    ? cat.color 
                                    : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300'
                                }
                                ${count === 0 && !isActive ? 'opacity-40 cursor-default' : ''}
                            `}
                        >
                            {cat.label}
                            <span className={`text-[9px] font-normal ${isActive ? 'opacity-80' : 'opacity-50'}`}>({count})</span>
                        </button>
                    );
                 })}

                 {hasActiveFilters && (
                     <button 
                        onClick={() => {
                            setFilterCategories(new Set());
                            setFilterBasins(new Set());
                        }}
                        className="ml-auto text-[10px] text-slate-500 hover:text-rose-400 font-medium px-2"
                     >
                         Clear
                     </button>
                 )}
              </div>
              
              {/* GLOBAL ACTIONS ROW */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800">
                  <div className="flex gap-2">
                      <button 
                        onClick={() => expandAll()} 
                        className="text-[10px] text-slate-500 hover:text-cyan-400 uppercase font-bold tracking-wider"
                      >
                          Expand All
                      </button>
                      <span className="text-slate-700 text-[10px]">|</span>
                      <button 
                        onClick={() => {
                            // Fix type inference here by explicit casting or using generics
                            const uniqueYears = Array.from(new Set(filtered.map((s: Storm) => s.year))) as number[];
                            collapseAll(uniqueYears);
                        }} 
                        className="text-[10px] text-slate-500 hover:text-cyan-400 uppercase font-bold tracking-wider"
                      >
                          Collapse All
                      </button>
                  </div>

                  {filtered.length > 0 && (
                      <button 
                        onClick={toggleSelectAllFiltered}
                        className="flex items-center gap-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-2 py-1 text-slate-300 transition-colors uppercase font-bold tracking-wide"
                      >
                          <div className={`w-2.5 h-2.5 rounded-sm border ${areAllFilteredSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`} />
                          {areAllFilteredSelected ? 'Deselect All Matches' : `Select All ${filtered.length}`}
                      </button>
                  )}
              </div>

              {/* List */}
              <div 
                 ref={listRef}
                 className="max-h-[50vh] overflow-y-auto custom-scrollbar bg-slate-950"
              >
                 {flatItems.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center p-4">
                       <p className="text-slate-500 text-sm font-medium mb-1">
                          No storms found.
                       </p>
                       <p className="text-slate-600 text-xs mb-6 max-w-[240px]">
                          Try changing the scope/filters or importing new storm data.
                       </p>
                       
                       <button 
                          onClick={() => { onImport(); setIsOpen(false); }}
                          className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-cyan-900/20 transition-all flex items-center gap-2 group"
                       >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          Import Data for {activeLabel}
                       </button>
                    </div>
                 ) : (
                    flatItems.map((item, index) => {
                        const isHighlighted = index === highlightedIndex;
                        
                        // YEAR HEADER
                        if (item.type === 'year') {
                            const areAllYearSelected = item.ids.length > 0 && item.selectedCount === item.ids.length;
                            
                            return (
                                <div 
                                    key={`year-${item.year}`}
                                    ref={el => { itemRefs.current[index] = el; }}
                                    className={`
                                        sticky top-0 z-20 bg-slate-950 border-b border-slate-800 shadow-md flex justify-between items-center px-4 py-2 cursor-pointer
                                        ${isHighlighted ? 'bg-slate-900' : ''}
                                    `}
                                    onClick={() => toggleYearCollapse(item.year)}
                                >
                                    <div className="flex items-center gap-2">
                                        <svg 
                                            className={`h-3 w-3 text-slate-500 transition-transform ${item.isCollapsed ? '-rotate-90' : 'rotate-0'}`} 
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{item.year} Season</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="opacity-60 font-mono font-normal text-[10px] text-slate-500">{item.count} Storms</span>
                                        <button 
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onSelectBatch(item.ids, !areAllYearSelected);
                                                inputRef.current?.focus();
                                            }}
                                            className="text-[9px] bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded px-2 py-0.5 transition-colors font-bold uppercase tracking-wider"
                                        >
                                            {areAllYearSelected ? 'Deselect All' : 'Select All'}
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                        
                        // MONTH HEADER
                        if (item.type === 'month') {
                            const areAllMonthSelected = item.ids.length > 0 && item.ids.every(id => selectedIds.has(id));
                            return (
                                <div 
                                    key={`month-${item.year}-${item.label}`}
                                    ref={el => { itemRefs.current[index] = el; }}
                                    className="px-4 py-1.5 flex items-center justify-between bg-slate-900/60 border-y border-slate-800/50"
                                >
                                    <div className="flex items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-5">
                                        <span className="w-1 h-1 rounded-full bg-slate-600 mr-2"></span>
                                        {item.label}
                                    </div>
                                    <button 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onSelectBatch(item.ids, !areAllMonthSelected);
                                            inputRef.current?.focus();
                                        }}
                                        className="text-[9px] text-slate-600 hover:text-cyan-400 transition-colors uppercase font-bold"
                                    >
                                        {areAllMonthSelected ? 'Deselect' : 'Select All'}
                                    </button>
                                </div>
                            );
                        }

                        // STORM ITEM
                        if (item.type === 'storm') {
                            const storm = item.storm;
                            const isSelected = selectedIds.has(storm.id);

                            return (
                               <div
                                  key={storm.id}
                                  ref={el => { itemRefs.current[index] = el; }}
                                  onClick={() => { onSelect(storm.id); setIsOpen(false); }}
                                  onMouseEnter={() => setHighlightedIndex(index)}
                                  className={`
                                     flex items-center px-4 py-2.5 cursor-pointer transition-colors group border-b border-slate-900
                                     ${isHighlighted ? 'bg-cyan-900/20' : 'hover:bg-slate-900'}
                                     ${isSelected ? 'bg-emerald-900/10' : ''}
                                  `}
                               >
                                  {/* Multi-Select Checkbox */}
                                  <div 
                                     onClick={(e) => { 
                                         e.preventDefault();
                                         e.stopPropagation(); 
                                         onToggle(storm.id); 
                                         inputRef.current?.focus();
                                     }}
                                     className="mr-3 p-1 rounded hover:bg-white/10 cursor-pointer"
                                     title="Toggle selection (Ctrl+Enter)"
                                  >
                                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600 bg-slate-900'}`}>
                                          {isSelected && (
                                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                              </svg>
                                          )}
                                      </div>
                                  </div>

                                  <div className="flex-1 flex flex-col justify-center min-w-0">
                                      <div className="flex items-center gap-2">
                                         <span className={`font-bold truncate ${isHighlighted ? 'text-cyan-100' : 'text-slate-300'}`}>{storm.name}</span>
                                         <span className="text-xs text-slate-500 font-mono hidden sm:inline-block opacity-50">{storm.id}</span>
                                      </div>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                      {isSelected && (
                                          <span className="text-emerald-500 text-[10px] flex items-center gap-1 font-bold uppercase tracking-wider">
                                              Active
                                          </span>
                                      )}
                                      <div 
                                        className="px-2 py-0.5 rounded text-[10px] font-bold min-w-[30px] text-center shadow-sm"
                                        style={{ 
                                            background: getIntensityColor(storm),
                                            color: '#1e293b' // dark slate text for contrast
                                        }}
                                      >
                                         {getIntensityText(storm)}
                                      </div>
                                  </div>
                               </div>
                            );
                        }
                        return null;
                    })
                 )}
              </div>
              
              {/* Footer */}
              <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
                 <div className="flex gap-3">
                    <span>{filtered.length} matches</span>
                    <span className={`${activeCount > 10 ? 'text-cyan-400 font-bold' : ''}`}>
                        {activeCount} selected
                    </span>
                 </div>
                 <div className="flex gap-4">
                    <span><kbd className="font-sans">↑↓</kbd> navigate</span>
                    <span><kbd className="font-sans">←→</kbd> collapse</span>
                    <span><kbd className="font-sans">↵</kbd> select</span>
                 </div>
              </div>

           </div>
        </div>
      , document.body)}
    </>
  );
};

export default StormSelector;