
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
  selectedId: string;
  onSelect: (id: string) => void;
  activePreset: string;
  onPresetChange: (preset: string) => void;
  presetOptions: PresetOption[];
  onImport: () => void;
}

const StormSelector: React.FC<StormSelectorProps> = ({ 
    storms, 
    selectedId, 
    onSelect,
    activePreset,
    onPresetChange,
    presetOptions,
    onImport
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setSearch(''); // Reset search on close
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Handle Keyboard Navigation
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
        setHighlightedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          onSelect(filtered[highlightedIndex].id);
          setIsOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, storms]); // Deps updated below

  const selectedStorm = storms.find(s => s.id === selectedId);

  // Filter Logic
  const filtered = useMemo(() => {
    if (!search) return storms;
    const q = search.toUpperCase();
    return storms.filter(s => 
      s.name.includes(q) || 
      s.id.includes(q) || 
      s.year.toString().includes(q)
    );
  }, [storms, search]);

  // Pre-select current storm when opening
  useEffect(() => {
     if (isOpen && selectedId && !search) {
        const idx = filtered.findIndex(s => s.id === selectedId);
        if (idx !== -1) setHighlightedIndex(idx);
     } else {
        setHighlightedIndex(0);
     }
  }, [isOpen, search]);

  // Auto-scroll to highlighted item
  useEffect(() => {
    if (isOpen && listRef.current) {
        const item = listRef.current.children[highlightedIndex] as HTMLElement;
        if (item) {
            item.scrollIntoView({ block: 'nearest' });
        }
    }
  }, [highlightedIndex, isOpen]);


  const getIntensityColor = (storm: Storm) => {
      const maxWind = Math.max(...storm.track.map(t => t.maxWind));
      if (maxWind >= 137) return INTENSITY_COLORS.CAT5;
      if (maxWind >= 113) return INTENSITY_COLORS.CAT4;
      if (maxWind >= 96) return INTENSITY_COLORS.CAT3;
      if (maxWind >= 83) return INTENSITY_COLORS.CAT2;
      if (maxWind >= 64) return INTENSITY_COLORS.CAT1;
      if (maxWind >= 34) return INTENSITY_COLORS.TS;
      return INTENSITY_COLORS.TD;
  };

  const getIntensityText = (storm: Storm) => {
      const maxWind = Math.max(...storm.track.map(t => t.maxWind));
      return getCategoryLabel(maxWind).replace('Category ', 'C');
  };

  const activeLabel = presetOptions.find(p => p.value === activePreset)?.label || 'current scope';
  const is2025 = activePreset === 'last1';
  
  const importBannerText = is2025 
      ? "Check NHC Best Track for active 2025 storms"
      : "1,900+ storms available to import from HURDAT2 Data Archive";

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
            {selectedStorm ? (
                <span className="text-slate-200 text-sm font-medium">{selectedStorm.name} <span className="text-slate-500 text-xs ml-1">({selectedStorm.year})</span></span>
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
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
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

              {/* Persistent Import Prompt Banner */}
              <div 
                 onClick={() => { onImport(); setIsOpen(false); }}
                 className="mx-3 mt-3 mb-2 px-3 py-2 bg-slate-950/50 border border-dashed border-slate-800 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-900 hover:border-cyan-500/30 transition-all group shrink-0"
              >
                 <div className="flex items-center gap-2 text-xs text-slate-400 group-hover:text-slate-300">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-600 group-hover:text-cyan-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                     </svg>
                     <span>{importBannerText}</span>
                 </div>
                 <span className="text-[10px] font-bold text-cyan-600 group-hover:text-cyan-400 uppercase tracking-wider bg-slate-900 group-hover:bg-slate-800 px-2 py-1 rounded border border-slate-800 group-hover:border-slate-700">Import</span>
              </div>

              {/* List */}
              <div 
                 ref={listRef}
                 className="max-h-[50vh] overflow-y-auto custom-scrollbar p-2 space-y-0.5 bg-slate-950"
              >
                 {filtered.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center">
                       <p className="text-slate-500 text-sm font-medium mb-1">
                          No storms found in this scope.
                       </p>
                       <p className="text-slate-600 text-xs mb-6 max-w-[240px]">
                          Try changing the scope or importing new storm data.
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
                    filtered.map((storm, index) => {
                        const isActive = index === highlightedIndex;
                        const isSelected = storm.id === selectedId;
                        const yearChanged = index > 0 && filtered[index-1].year !== storm.year;
                        
                        return (
                           <React.Fragment key={storm.id}>
                               {(index === 0 || yearChanged) && (
                                   <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800/50 mt-1 mb-1">
                                      {storm.year} Season
                                   </div>
                               )}
                               
                               <div
                                  onClick={() => { onSelect(storm.id); setIsOpen(false); }}
                                  onMouseEnter={() => setHighlightedIndex(index)}
                                  className={`
                                     flex items-center px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                                     ${isActive ? 'bg-cyan-900/20' : 'hover:bg-slate-900'}
                                     ${isSelected ? 'border border-cyan-500/30' : 'border border-transparent'}
                                  `}
                               >
                                  <div className="flex-1 flex flex-col justify-center min-w-0">
                                      <div className="flex items-center gap-2">
                                         <span className={`font-bold truncate ${isActive ? 'text-cyan-100' : 'text-slate-300'}`}>{storm.name}</span>
                                         <span className="text-xs text-slate-500 font-mono hidden sm:inline-block">{storm.id}</span>
                                      </div>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase">{storm.id.substring(0,2)}</span>
                                      
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
                           </React.Fragment>
                        );
                    })
                 )}
              </div>
              
              {/* Footer */}
              <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
                 <span>{filtered.length} storms</span>
                 <div className="flex gap-3">
                    <span><kbd className="font-sans">↑↓</kbd> navigate</span>
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
