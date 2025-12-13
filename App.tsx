import React, { useState, useEffect, useMemo, useRef } from 'react';
import { parseHurdat2 } from './utils/parser';
import { SAMPLE_HURDAT_DATA, PRELOADED_SEASON_DATA, getCategoryLabel, STORM_STATUS_COLORS, STORM_IDENTITY_PALETTE } from './constants';
import { Storm } from './types';
import StormChart from './components/StormChart';
import StormMap from './components/StormMap';
import StormDataTable from './components/StormDataTable';
import StormSummary from './components/StormSummary';
import DataImporter, { ImportTab } from './components/DataImporter';
import StormSelector from './components/StormSelector';

const MAX_VIEW_STORMS = 7;
const HURDAT_ARCHIVE_URL = "https://corsproxy.io/?https://www.aoml.noaa.gov/hrd/hurdat/hurdat2-1851-2023-051124.txt";
const ATCF_BTK_URL = "https://corsproxy.io/?https://ftp.nhc.noaa.gov/atcf/btk/";

const App: React.FC = () => {
  // We keep two sets of data:
  // 1. Defaults (Static/Preloaded)
  // 2. User Imports (Persisted in LocalStorage)
  const [defaultStorms, setDefaultStorms] = useState<Storm[]>([]);
  const [userStorms, setUserStorms] = useState<Storm[]>([]);
  
  // State for View
  // activeStormIds represents ORDERED list. 
  // Indices 0 to (MAX_VIEW_STORMS-1) are visible. Rest are hidden (overflow).
  // Default: Melissa (2025), Imelda (2025), Dorian (2019), Katrina (2005)
  const [activeStormIds, setActiveStormIds] = useState<string[]>(['AL132025', 'AL092025', 'AL052019', 'AL122005']);
  const [focusedStormId, setFocusedStormId] = useState<string>(''); 
  const [isDefaultView, setIsDefaultView] = useState<boolean>(true);
  
  // UI State
  const [overflowMenuOpen, setOverflowMenuOpen] = useState<boolean>(false);

  const [showInput, setShowInput] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<ImportTab>('active');
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState<boolean>(true);
  const [loadingMessage, setLoadingMessage] = useState<string>("Initializing...");
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Reset Confirmation State
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  
  const currentYear = new Date().getFullYear();

  // View Filters
  const [filterYearStart, setFilterYearStart] = useState<number>(0);
  const [filterYearEnd, setFilterYearEnd] = useState<number>(0);
  // Default to 5 Years ('last5')
  const [activePreset, setActivePreset] = useState<string>('last5'); 

  // Refs for click outside handling
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // 1. Load Data & State on Mount
  useEffect(() => {
    const initApp = async () => {
      // Check Persistence first
      const savedStorms = localStorage.getItem('hurdat_user_storms');
      let loadedFromSave = false;
      
      if (savedStorms) {
        try {
          const parsed = JSON.parse(savedStorms);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setUserStorms(parsed);
            loadedFromSave = true;
          }
        } catch (e) {
          console.error("Failed to parse saved storms", e);
        }
      }

      if (loadedFromSave) {
          setIsLoadingDefaults(false);
          setIsHydrated(true);
          return;
      }

      // If no persistence, load defaults (Archive + Live Best Tracks)
      try {
         // A. Fetch Historical Archive
         setLoadingMessage("Fetching NOAA HURDAT2 Archive (1851-2023)...");
         const archiveRes = await fetch(HURDAT_ARCHIVE_URL);
         if (!archiveRes.ok) throw new Error("Failed to fetch default data");
         const archiveText = await archiveRes.text();
         const archiveStorms = parseHurdat2(archiveText);

         // B. Fetch Live Best Track Data (2024 & 2025)
         setLoadingMessage("Scanning NHC for 2024-2025 Best Tracks...");
         let liveStorms: Storm[] = [];
         try {
            const dirRes = await fetch(ATCF_BTK_URL);
            if (dirRes.ok) {
                const html = await dirRes.text();
                // Match filenames like bal012024.dat, bep092025.dat, etc.
                const fileRegex = /href="(b[a-z]{2}\d{2}(2024|2025)\.dat)"/g;
                const matches = [...html.matchAll(fileRegex)];
                const filesToFetch = matches.map(m => m[1]);

                if (filesToFetch.length > 0) {
                    setLoadingMessage(`Downloading ${filesToFetch.length} active storm files...`);
                    
                    // Fetch in parallel
                    const filePromises = filesToFetch.map(async (filename) => {
                        try {
                            const r = await fetch(`https://corsproxy.io/?https://ftp.nhc.noaa.gov/atcf/btk/${filename}`);
                            if (r.ok) return await r.text();
                        } catch(e) { return null; }
                        return null;
                    });
                    
                    const rawDataList = await Promise.all(filePromises);
                    rawDataList.forEach(raw => {
                        if (raw) {
                            const parsed = parseHurdat2(raw);
                            liveStorms.push(...parsed);
                        }
                    });
                }
            }
         } catch (btkError) {
             console.warn("Failed to fetch live best tracks, falling back to static 2024 data", btkError);
             // Fallback to static if live fetch fails completely
             liveStorms = parseHurdat2(PRELOADED_SEASON_DATA);
         }
         
         // C. Combine: Prefer Live Best Track over Archive/Static if IDs overlap
         const liveIds = new Set(liveStorms.map(s => s.id));
         const filteredArchive = archiveStorms.filter(s => !liveIds.has(s.id));
         const combined = [...liveStorms, ...filteredArchive];
         
         // Initial Sort
         combined.sort((a,b) => {
             if (b.year !== a.year) return b.year - a.year;
             return b.id.localeCompare(a.id);
         });

         setUserStorms(combined);
         
      } catch (e) {
         console.error("Default load failed", e);
         // Fallback to empty state
      } finally {
         setIsLoadingDefaults(false);
         setIsHydrated(true);
      }
    };
    initApp();
  }, []);

  // 2. Save User Persistence on Change
  useEffect(() => {
    if (isHydrated && !isLoadingDefaults) {
      try {
        if (userStorms.length > 0) {
            localStorage.setItem('hurdat_user_storms', JSON.stringify(userStorms));
        }
      } catch (e) {
        // Quota exceeded is expected with full dataset, silence warning or just log
        // console.warn("Quota exceeded, could not save storms", e);
      }
    }
  }, [userStorms, isHydrated, isLoadingDefaults]);

  // Click Outside Listener for Menus
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (overflowMenuRef.current && !overflowMenuRef.current.contains(event.target as Node)) {
              setOverflowMenuOpen(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  // Combined Storms List (Memoized)
  const storms = useMemo(() => {
    const userIds = new Set(userStorms.map(s => s.id));
    const activeDefaults = defaultStorms.filter(s => !userIds.has(s.id));
    const activeUser = userStorms;
    const all = [...activeUser, ...activeDefaults];
    
    return all.sort((a,b) => {
       if (b.year !== a.year) return b.year - a.year;
       return b.id.localeCompare(a.id);
    });
  }, [defaultStorms, userStorms]);

  // Determine Data Bounds
  const { dataMinYear, dataMaxYear } = useMemo(() => {
    const cy = new Date().getFullYear();
    if (storms.length === 0) return { dataMinYear: 1851, dataMaxYear: cy + 1 };
    
    const years = storms.map(s => s.year);
    const max = Math.max(...years, cy);
    const min = Math.min(...years);
    return { dataMinYear: min, dataMaxYear: max };
  }, [storms]);

  // Filtered list for the selector
  const visibleStormsSelector = useMemo(() => {
    return storms.filter(s => 
       (filterYearStart === 0 || s.year >= filterYearStart) && 
       (filterYearEnd === 0 || s.year <= filterYearEnd)
    );
  }, [storms, filterYearStart, filterYearEnd]);


  // Sync filters to data bounds
  useEffect(() => {
    if (filterYearStart === 0 && dataMinYear > 0) {
       if (activePreset === 'last5') {
          setFilterYearStart(currentYear - 5);
          setFilterYearEnd(currentYear);
       } else if (activePreset === 'last1') {
          setFilterYearStart(2025);
          setFilterYearEnd(2025);
       } else {
          setFilterYearStart(dataMinYear);
          setFilterYearEnd(dataMaxYear);
       }
    }
  }, [dataMinYear, dataMaxYear, filterYearStart, activePreset, currentYear]);

  // Handle new data from importer
  const handleDataImport = (newStorms: Storm[]) => {
    setUserStorms(prev => {
      const newIds = new Set(newStorms.map(s => s.id));
      const keptOld = prev.filter(s => !newIds.has(s.id));
      return [...keptOld, ...newStorms];
    });

    if (newStorms.length > 0) {
        const years = newStorms.map(s => s.year);
        const minImport = Math.min(...years);
        const maxImport = Math.max(...years);
        
        setFilterYearStart(minImport);
        setFilterYearEnd(maxImport);
        setActivePreset(''); 
    }
    
    setShowInput(false);
  };

  const handleManualSave = () => {
    // Feature Disabled
  };

  const executeReset = () => {
    setUserStorms([]);
    setActivePreset('last5');
    setFilterYearStart(currentYear - 5);
    setFilterYearEnd(currentYear);
    // Force clear local storage
    setTimeout(() => { localStorage.removeItem('hurdat_user_storms'); }, 0);
    setActiveStormIds([]);
    setFocusedStormId('');
    setShowResetModal(false);
    setIsDefaultView(true);
  };

  const applyYearPreset = (preset: string) => {
      setActivePreset(preset);
      switch(preset) {
          case 'last1': setFilterYearStart(2025); setFilterYearEnd(2025); break;
          case 'last5': setFilterYearStart(currentYear - 5); setFilterYearEnd(currentYear); break;
          case 'last20': setFilterYearStart(currentYear - 20); setFilterYearEnd(currentYear); break;
          case 'satellite': setFilterYearStart(1979); setFilterYearEnd(currentYear); break;
          case 'all': setFilterYearStart(dataMinYear); setFilterYearEnd(currentYear + 1); break;
      }
  };
  
  const isPresetDisabled = (value: string) => {
      if (storms.length === 0) return true;
      switch(value) {
          case 'last1': return dataMaxYear < 2025; 
          case 'last5': return dataMinYear > (currentYear - 5);
          case 'last20': return dataMinYear > (currentYear - 20);
          case 'satellite': return dataMinYear > 1979;
          case 'all': return false;
          default: return false;
      }
  };

  // --- SELECTION & SWAPPING LOGIC ---

  const handleStormOpen = (id: string) => {
      // First interaction check: Clear default storms on first search/select
      if (isDefaultView) {
          setIsDefaultView(false);
          setActiveStormIds([id]);
          setFocusedStormId(id);
          return;
      }

      if (activeStormIds.includes(id)) {
          // If storm is already active but hidden (overflow), swap it into view
          const idx = activeStormIds.indexOf(id);
          if (idx >= MAX_VIEW_STORMS) {
              const newOrder = [...activeStormIds];
              // Remove from overflow
              newOrder.splice(idx, 1);
              // Insert at last visible position (index 6)
              newOrder.splice(MAX_VIEW_STORMS - 1, 0, id);
              setActiveStormIds(newOrder);
          }
      } else {
          // Add new storm
          const newOrder = [...activeStormIds];
          if (newOrder.length < MAX_VIEW_STORMS) {
               newOrder.push(id);
          } else {
               // Full view: Insert at last visible position (index 6), pushing old 6 to overflow
               newOrder.splice(MAX_VIEW_STORMS - 1, 0, id);
          }
          setActiveStormIds(newOrder);
      }
      setFocusedStormId(id);
  };

  const handleStormToggle = (id: string) => {
      if (activeStormIds.includes(id)) {
          // Closing
          handleCloseStorm(null, id);
      } else {
          handleStormOpen(id);
      }
  };

  const handleBatchSelect = (ids: string[], select: boolean) => {
      // If batch selecting for the first time, treat it as breaking default view
      if (isDefaultView && select) {
          setIsDefaultView(false);
          setActiveStormIds(ids);
          if (ids.length > 0) setFocusedStormId(ids[0]);
          return;
      }

      if (select) {
          const newIds = ids.filter(id => !activeStormIds.includes(id));
          if (newIds.length === 0) return;
          setActiveStormIds([...activeStormIds, ...newIds]);
          if (!focusedStormId) setFocusedStormId(newIds[0]);
      } else {
          const newActive = activeStormIds.filter(id => !ids.includes(id));
          setActiveStormIds(newActive);
          if (ids.includes(focusedStormId)) {
             setFocusedStormId(newActive.length > 0 ? newActive[0] : '');
          }
      }
  };

  const handleCloseStorm = (e: React.MouseEvent | null, id: string) => {
      e?.stopPropagation();
      const newActive = activeStormIds.filter(sid => sid !== id);
      setActiveStormIds(newActive);
      
      if (focusedStormId === id) {
          // If we closed the focused storm, check visibility of remaining
          if (newActive.length > 0) {
              // Try to focus the one that took its place, or the last one
              setFocusedStormId(newActive[0]);
          } else {
              setFocusedStormId('');
          }
      }
  };
  
  // TOGGLE VISIBILITY LOGIC (For View Manager)
  const handleToggleVisibility = (id: string) => {
      const idx = activeStormIds.indexOf(id);
      if (idx === -1) return;
      
      const newOrder = [...activeStormIds];
      const isVisible = idx < MAX_VIEW_STORMS;
      
      if (isVisible) {
          // Move from Visible -> Hidden (Bank)
          // Strategy: Move to end of list.
          const [item] = newOrder.splice(idx, 1);
          newOrder.push(item);
      } else {
          // Move from Hidden -> Visible
          // Strategy: Move to last visible slot (MAX_VIEW_STORMS - 1).
          // If list is full, this naturally pushes the item currently at that slot to the overflow.
          const [item] = newOrder.splice(idx, 1);
          const targetIdx = Math.min(newOrder.length, MAX_VIEW_STORMS - 1);
          newOrder.splice(targetIdx, 0, item);
          setFocusedStormId(id);
      }
      setActiveStormIds(newOrder);
  };


  // Derived Objects
  const visibleIds = activeStormIds.slice(0, MAX_VIEW_STORMS);
  const hiddenIds = activeStormIds.slice(MAX_VIEW_STORMS);
  
  const visibleStorms = visibleIds.map(id => storms.find(s => s.id === id)).filter(Boolean) as Storm[];
  const hiddenStorms = hiddenIds.map(id => storms.find(s => s.id === id)).filter(Boolean) as Storm[];
  
  const focusedStorm = useMemo(() => 
      storms.find(s => s.id === focusedStormId), 
  [storms, focusedStormId]);

  // --- IDENTITY COLOR MAPPING ---
  // Create a mapping of Storm ID -> Identity Color based on index in visibleStorms
  // This ensures colors are consistent across map, tabs, and charts
  const stormColors = useMemo(() => {
     const map: Record<string, string> = {};
     visibleStorms.forEach((s, idx) => {
         map[s.id] = STORM_IDENTITY_PALETTE[idx % STORM_IDENTITY_PALETTE.length];
     });
     return map;
  }, [visibleStorms]);

  const YEAR_PRESETS = [
    { label: "'25", value: 'last1', title: '2025 Season' },
    { label: 'Last 5 yrs', value: 'last5' },
    { label: 'Last 20 yrs', value: 'last20' },
    { label: 'Satellite Era', value: 'satellite', title: 'Satellite Era (1979+)' },
    { label: 'All', value: 'all' },
  ];

  const presetOptions = YEAR_PRESETS.map(p => ({
     ...p,
     disabled: isPresetDisabled(p.value)
  }));
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-[0_0_15px_rgba(6,182,212,0.5)] flex items-center justify-center font-bold text-white text-xs">
              H2
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent inline-block mr-2">
                HURDAT2 <span className="text-slate-500 font-medium">Visualizer</span>
              </h1>
              <span className="text-xs text-slate-500 font-medium hidden lg:inline-block border-l border-slate-700 pl-3">
                A tool to view and filter 170+ years of NOAA Hurricane Data
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Show Reset Button ONLY if data exists (and not loading) */}
            {!isLoadingDefaults && userStorms.length > 0 && (
                <button
                  onClick={() => setShowResetModal(true)}
                  className="text-xs transition-colors px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-900/50 font-medium"
                  title="Clear imported data"
                >
                  Reset Data
                </button>
            )}

            {/* Show Import Button ONLY if data is empty (and not loading) */}
            {!isLoadingDefaults && userStorms.length === 0 && (
                <button
                  onClick={() => {
                     setImportTab('active');
                     setShowInput(true);
                  }}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded-full text-sm font-semibold transition-all shadow-lg shadow-cyan-900/20 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import Data
                </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">

        {isLoadingDefaults ? (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
                <div className="w-12 h-12 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                <h2 className="text-xl font-bold text-slate-200">Loading Historical Data</h2>
                <p className="text-slate-500 mt-2 text-sm">{loadingMessage}</p>
            </div>
        ) : (
           <>
                {/* Control Bar */}
                <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl backdrop-blur-sm shadow-lg">
                
                <div className="flex flex-wrap gap-3 items-center">
                    
                    {/* Command Palette Storm Selector */}
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <StormSelector 
                        storms={visibleStormsSelector} 
                        selectedIds={new Set(activeStormIds)} 
                        onSelect={handleStormOpen}
                        onToggle={handleStormToggle}
                        onSelectBatch={handleBatchSelect}
                        activePreset={activePreset}
                        onPresetChange={applyYearPreset}
                        presetOptions={presetOptions}
                        onImport={() => {
                            const targetTab = activePreset === 'last1' ? 'active' : 'archive';
                            setImportTab(targetTab);
                            setShowInput(true);
                        }}
                        />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500 font-medium whitespace-nowrap hidden sm:flex">
                        <span><span className="text-slate-300 font-bold">{visibleStormsSelector.length}</span> storms</span>
                    </div>

                    {/* Year Range Inputs */}
                    <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 shadow-sm shrink-0 h-[38px]">
                        <input 
                        type="number" 
                        value={filterYearStart}
                        onChange={(e) => { setFilterYearStart(Number(e.target.value)); setActivePreset(''); }}
                        className="bg-transparent w-16 text-center text-sm outline-none text-slate-300 font-mono"
                        />
                        <span className="text-slate-600">-</span>
                        <input 
                        type="number" 
                        value={filterYearEnd}
                        onChange={(e) => { setFilterYearEnd(Number(e.target.value)); setActivePreset(''); }}
                        className="bg-transparent w-16 text-center text-sm outline-none text-slate-300 font-mono"
                        />
                    </div>

                    <div className="hidden xl:block w-px h-8 bg-slate-700 mx-2"></div>

                    {/* Preset Buttons */}
                    <div className="flex flex-wrap items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50 shrink-0 w-full sm:w-auto justify-center sm:justify-start ml-auto xl:ml-0 h-[38px]">
                        {presetOptions.map(preset => {
                        return (
                            <button 
                                key={preset.value}
                                onClick={() => applyYearPreset(preset.value)}
                                disabled={preset.disabled}
                                title={preset.title}
                                className={`px-3 py-1 text-xs font-bold rounded transition-colors whitespace-nowrap h-full flex items-center ${
                                    preset.disabled 
                                        ? 'text-slate-600 cursor-not-allowed opacity-50 bg-slate-800/50'
                                        : activePreset === preset.value 
                                        ? 'bg-cyan-600 text-white shadow-sm' 
                                        : 'text-slate-400 hover:text-cyan-400 hover:bg-slate-700'
                                }`}
                            >
                                {preset.label}
                            </button>
                        );
                        })}
                    </div>

                </div>
                </div>

                {/* ACTIVE STORM TABS */}
                {visibleStorms.length > 0 && (
                    <div className="flex items-center gap-2 overflow-visible pb-2 relative">
                        
                        {visibleStorms.map(storm => {
                            const isFocused = storm.id === focusedStormId;
                            const maxWind = Math.max(...storm.track.map(t => t.maxWind));
                            const identityColor = stormColors[storm.id] || '#94a3b8';
                            
                            // Metadata
                            let peakStatus = 'TD';
                            if (maxWind >= 64) peakStatus = 'HU';
                            else if (maxWind >= 34) peakStatus = 'TS';

                            let shortCat = 'TD';
                            if (maxWind >= 137) shortCat = 'Cat 5';
                            else if (maxWind >= 113) shortCat = 'Cat 4';
                            else if (maxWind >= 96) shortCat = 'Cat 3';
                            else if (maxWind >= 83) shortCat = 'Cat 2';
                            else if (maxWind >= 64) shortCat = 'Cat 1';
                            else if (maxWind >= 34) shortCat = 'TS';

                            return (
                                <div 
                                    key={storm.id}
                                    className={`
                                        relative flex items-center gap-2 pl-3 pr-2 py-2 rounded-t-lg border-t border-x border-b-0 min-w-[140px] max-w-[200px] transition-all group
                                        ${isFocused 
                                            ? 'bg-slate-800 border-slate-700 text-slate-200 shadow-sm z-10' 
                                            : 'bg-slate-900/50 border-transparent text-slate-500 hover:bg-slate-800/50 hover:text-slate-400'}
                                    `}
                                    onClick={() => setFocusedStormId(storm.id)}
                                >
                                    {/* Identity Color Indicator */}
                                    <span 
                                       className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor]"
                                       style={{ backgroundColor: identityColor, color: identityColor }}
                                    ></span>
                                    
                                    <div className="flex flex-col min-w-0 flex-1 justify-center cursor-pointer">
                                        <div className="flex items-center gap-2 truncate leading-tight">
                                            <span 
                                               className={`text-sm font-extrabold ${isFocused ? 'text-white' : 'text-slate-300'}`}
                                            >
                                                {storm.name}
                                            </span>
                                            {peakStatus && <span className={`text-xs font-bold ${isFocused ? 'text-cyan-400' : 'text-slate-500'}`}>{peakStatus}</span>}
                                        </div>
                                        <span className={`text-[10px] font-medium mt-0.5 ${isFocused ? 'text-slate-400' : 'text-slate-600'}`}>{storm.year} - {shortCat}</span>
                                    </div>
                                    
                                    <div className="flex items-center gap-1">
                                        <button 
                                            onClick={(e) => handleCloseStorm(e, storm.id)}
                                            className={`p-1 rounded-full hover:bg-slate-700 transition-colors ${isFocused ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-300'}`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </div>
                                    
                                    {/* Active Highlight Line */}
                                    {isFocused && (
                                       <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: identityColor }}></div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Overflow / View Manager Button */}
                        {hiddenStorms.length > 0 && (
                            <div className="relative h-full" ref={overflowMenuRef as any}>
                                <button 
                                onClick={() => setOverflowMenuOpen(!overflowMenuOpen)}
                                className={`
                                        h-[46px] px-3 py-2 rounded-lg transition-colors flex items-center gap-1 shrink-0 border font-bold text-xs
                                        ${overflowMenuOpen ? 'bg-slate-800 text-cyan-400 border-cyan-500' : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:text-cyan-400 hover:bg-slate-800/50'}
                                `}
                                >
                                    <span className="whitespace-nowrap">+{hiddenStorms.length} More</span>
                                    <svg className={`w-3 h-3 transition-transform ${overflowMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                
                                {/* Overflow View Manager */}
                                {overflowMenuOpen && (
                                    <div className="absolute top-full right-0 mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 animate-fade-in flex flex-col max-h-80 overflow-y-auto custom-scrollbar">
                                        <div className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase bg-slate-900 sticky top-0 border-b border-slate-700/50">
                                            View Manager
                                        </div>
                                        
                                        {activeStormIds.map((id, index) => {
                                            const storm = storms.find(s => s.id === id);
                                            if (!storm) return null;
                                            
                                            const isVisible = index < MAX_VIEW_STORMS;
                                            
                                            // For overflow items, if they are visible, they have an assigned color.
                                            // If hidden/banked, we give them a generic color.
                                            const identityColor = isVisible 
                                                ? (stormColors[storm.id] || '#94a3b8')
                                                : '#94a3b8';

                                            return (
                                                <button
                                                    key={id}
                                                    onClick={() => handleToggleVisibility(id)}
                                                    className={`
                                                        w-full text-left px-3 py-1.5 border-b border-slate-700/50 last:border-0 flex items-center gap-2 transition-all group
                                                        ${isVisible 
                                                            ? 'bg-slate-800/50 border-l-2 pl-2.5' // Visual "Active" state
                                                            : 'border-l-2 border-l-transparent pl-2.5 hover:bg-slate-800 opacity-60 hover:opacity-100' // Bank state
                                                        }
                                                    `}
                                                    style={{ borderLeftColor: isVisible ? identityColor : 'transparent' }}
                                                >
                                                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: identityColor }}></div>
                                                    
                                                    <div className="flex-1 min-w-0 flex items-center justify-between">
                                                        <span className={`font-bold truncate text-xs ${isVisible ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                                            {storm.name}
                                                        </span>
                                                        <span className="text-[9px] text-slate-600 font-mono ml-2">{storm.year}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Dashboard Content */}
                <div className="space-y-10 animate-fade-in bg-slate-900/20 p-4 rounded-xl border border-slate-800/50">
                {/* Top Row: Summary Stats (Focused Storm) */}
                <StormSummary 
                    storm={focusedStorm} 
                    identityColor={focusedStorm ? stormColors[focusedStorm.id] : undefined}
                />

                {/* Middle Row: Map & Chart (Stacked Vertically now) */}
                <div className="flex flex-col gap-6">
                    <div className="space-y-2 w-full">
                    <StormMap 
                        storms={visibleStorms} 
                        focusedStormId={focusedStormId} 
                        onStormFocus={setFocusedStormId}
                        stormColors={stormColors}
                    />
                    </div>
                    <div className="space-y-2 w-full">
                    <StormChart 
                        storm={focusedStorm} 
                        color={focusedStorm ? stormColors[focusedStorm.id] : undefined}
                    />
                    </div>
                </div>

                {/* Bottom Row: Data Table (Focused Storm) */}
                <StormDataTable 
                    activeStorms={visibleStorms} 
                    focusedStormId={focusedStormId} 
                    onFocus={setFocusedStormId} 
                    stormColors={stormColors}
                />
                </div>
           </>
        )}
        
      </main>

      {/* Import Modal */}
      {showInput && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-4xl relative">
            <button 
              onClick={() => setShowInput(false)}
              className="absolute -top-10 right-0 text-slate-400 hover:text-white transition-colors"
            >
              Close [ESC]
            </button>
            <DataImporter onImport={handleDataImport} onClose={() => setShowInput(false)} initialTab={importTab} />
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
           <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-2">Reset Workspace?</h3>
              <p className="text-slate-400 text-sm mb-6">
                 This will remove all storms and revert the app to an empty state. You can then import specific datasets manually.
              </p>
              <div className="flex gap-3">
                 <button 
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium"
                 >
                    Cancel
                 </button>
                 <button 
                    onClick={executeReset}
                    className="flex-1 px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 font-bold shadow-lg shadow-rose-900/20"
                 >
                    Confirm Reset
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;