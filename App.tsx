import React, { useState, useEffect, useMemo } from 'react';
import { parseHurdat2 } from './utils/parser';
import { SAMPLE_HURDAT_DATA, PRELOADED_SEASON_DATA, getCategoryLabel } from './constants';
import { Storm } from './types';
import StormChart from './components/StormChart';
import StormMap from './components/StormMap';
import StormDataTable from './components/StormDataTable';
import StormSummary from './components/StormSummary';
import DataImporter, { ImportTab } from './components/DataImporter';
import StormSelector from './components/StormSelector';

const App: React.FC = () => {
  // We keep two sets of data:
  // 1. Defaults (Static/Preloaded)
  // 2. User Imports (Persisted in LocalStorage)
  const [defaultStorms, setDefaultStorms] = useState<Storm[]>([]);
  const [userStorms, setUserStorms] = useState<Storm[]>([]);
  
  // State for View
  const [selectedStormId, setSelectedStormId] = useState<string>('');
  const [showInput, setShowInput] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<ImportTab>('active');
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Reset Confirmation State
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  
  const currentYear = new Date().getFullYear();

  // View Filters
  const [filterYearStart, setFilterYearStart] = useState<number>(0);
  const [filterYearEnd, setFilterYearEnd] = useState<number>(0);
  // Default to 5 Years ('last5')
  const [activePreset, setActivePreset] = useState<string>('last5'); 

  // 1. Load Data & State on Mount
  useEffect(() => {
    const initApp = () => {
      try {
        // A. Load Defaults
        // Temporarily disabled preloaded data
        // const sampleParsed = parseHurdat2(SAMPLE_HURDAT_DATA);
        // const preloadedParsed = parseHurdat2(PRELOADED_SEASON_DATA);
        // setDefaultStorms([...sampleParsed, ...preloadedParsed]);
        setDefaultStorms([]);

        // B. Load Persisted User Storms
        const savedStorms = localStorage.getItem('hurdat_user_storms');
        if (savedStorms) {
          const parsed = JSON.parse(savedStorms);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setUserStorms(parsed);
          }
        }

        setIsHydrated(true);
      } catch (e) {
        console.error("Failed to initialize app", e);
        setIsHydrated(true); // Allow render even if fail
      }
    };
    initApp();
  }, []);

  // 2. Save User Persistence on Change
  useEffect(() => {
    if (isHydrated) {
      try {
        // Only save if we have items, otherwise let the clear handler manage the empty state
        if (userStorms.length > 0) {
            localStorage.setItem('hurdat_user_storms', JSON.stringify(userStorms));
        }
      } catch (e) {
        console.warn("Quota exceeded, could not save storms", e);
      }
    }
  }, [userStorms, isHydrated]);

  // Combined Storms List (Memoized)
  const storms = useMemo(() => {
    const userIds = new Set(userStorms.map(s => s.id));
    // User storms override defaults if ID matches
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
    const max = Math.max(...years, cy); // Ensure max includes current year if data exists
    const min = Math.min(...years);
    return { 
      dataMinYear: min, 
      dataMaxYear: max 
    };
  }, [storms]);

  // Filtered list for the selector based on date picker
  const visibleStorms = useMemo(() => {
    return storms.filter(s => 
       (filterYearStart === 0 || s.year >= filterYearStart) && 
       (filterYearEnd === 0 || s.year <= filterYearEnd)
    );
  }, [storms, filterYearStart, filterYearEnd]);

  // Auto-Select Logic
  useEffect(() => {
    if (isHydrated && !selectedStormId && storms.length > 0) {
      // Prefer visible storms first
      if (visibleStorms.length > 0) {
         setSelectedStormId(visibleStorms[0].id);
      } else {
         setSelectedStormId(storms[0].id);
      }
    }
  }, [storms, visibleStorms, selectedStormId, isHydrated]);

  // Sync filters to data bounds if not set (Initialization)
  useEffect(() => {
    if (filterYearStart === 0 && dataMinYear > 0) {
       // Apply Default Preset Logic based on activePreset state
       if (activePreset === 'last5') {
          setFilterYearStart(currentYear - 5);
          setFilterYearEnd(currentYear);
       } else if (activePreset === 'last1') {
          setFilterYearStart(2025);
          setFilterYearEnd(2025);
       } else {
          // Fallback to full range
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
      setSelectedStormId(newStorms[0].id);
    }
    setShowInput(false);
  };

  const handleManualSave = () => {
    setSaveStatus('saving');
    setUserStorms(storms);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  const executeReset = () => {
    setUserStorms([]);
    setActivePreset('last5');
    setFilterYearStart(currentYear - 5);
    setFilterYearEnd(currentYear);

    setTimeout(() => {
        localStorage.removeItem('hurdat_user_storms');
    }, 0);

    if (defaultStorms.length > 0) setSelectedStormId(defaultStorms[0].id);
    else setSelectedStormId('');
    
    setShowResetModal(false);
  };

  const applyYearPreset = (preset: string) => {
      setActivePreset(preset);
      switch(preset) {
          case 'last1':
              setFilterYearStart(2025);
              setFilterYearEnd(2025);
              break;
          case 'last5':
              setFilterYearStart(currentYear - 5);
              setFilterYearEnd(currentYear);
              break;
          case 'last20':
              setFilterYearStart(currentYear - 20);
              setFilterYearEnd(currentYear);
              break;
          case 'satellite':
              setFilterYearStart(1979);
              setFilterYearEnd(currentYear);
              break;
          case 'all':
              setFilterYearStart(dataMinYear);
              setFilterYearEnd(currentYear + 1);
              break;
      }
  };
  
  const isPresetDisabled = (value: string) => {
      if (storms.length === 0) return true;
      switch(value) {
          case 'last1': return dataMaxYear < 2025; // Disable if no 2025 data present
          case 'last5': return dataMinYear > (currentYear - 5);
          case 'last20': return dataMinYear > (currentYear - 20);
          case 'satellite': return dataMinYear > 1979;
          case 'all': return false;
          default: return false;
      }
  };

  const selectedStorm = useMemo(() => 
    storms.find(s => s.id === selectedStormId), 
  [storms, selectedStormId]);

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
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              HURDAT2 <span className="text-slate-500 font-medium hidden sm:inline">Visualizer</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowResetModal(true)}
              className="text-xs transition-colors mr-2 font-medium text-slate-500 hover:text-rose-400"
              title="Clear imported data"
            >
              Reset Data
            </button>
            
            <button
              onClick={handleManualSave}
              disabled={saveStatus !== 'idle'}
              className={`
                px-4 py-1.5 rounded-full text-sm font-semibold transition-all shadow-lg flex items-center gap-2
                ${saveStatus === 'saved' 
                   ? 'bg-emerald-600 text-white shadow-emerald-900/20' 
                   : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'}
              `}
            >
              {saveStatus === 'saved' ? (
                <>
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                   </svg>
                   Saved!
                </>
              ) : (
                <>
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                   </svg>
                   Save Workspace
                </>
              )}
            </button>

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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-10">
        
        {/* Control Bar */}
        <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl backdrop-blur-sm shadow-lg">
          
          <div className="flex flex-wrap gap-3 items-center">
             
             {/* Command Palette Storm Selector */}
             <div className="relative flex-1 min-w-[200px] max-w-sm">
                <StormSelector 
                   storms={visibleStorms} 
                   selectedId={selectedStormId} 
                   onSelect={setSelectedStormId}
                   activePreset={activePreset}
                   onPresetChange={applyYearPreset}
                   presetOptions={presetOptions}
                   onImport={() => {
                       // Contextual import: if on '25 preset, open active tab. Else archive.
                       const targetTab = activePreset === 'last1' ? 'active' : 'archive';
                       setImportTab(targetTab);
                       setShowInput(true);
                   }}
                />
             </div>

             <div className="flex items-center gap-3 text-xs text-slate-500 font-medium whitespace-nowrap hidden sm:flex">
                {/* BUTTON REMOVED FROM HERE */}
                <span><span className="text-slate-300 font-bold">{visibleStorms.length}</span> storms</span>
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

             {/* Divider / Spacer */}
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

        <div className="space-y-10 animate-fade-in">
          {/* Top Row: Summary Stats */}
          <StormSummary storm={selectedStorm} />

          {/* Middle Row: Map & Chart (Stacked Vertically now) */}
          <div className="flex flex-col gap-6">
            <div className="space-y-2 w-full">
              <StormMap storm={selectedStorm} />
            </div>
            <div className="space-y-2 w-full">
              <StormChart storm={selectedStorm} />
            </div>
          </div>

          {/* Bottom Row: Data Table */}
          <StormDataTable storm={selectedStorm} />
        </div>
        
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
                 This will remove <span className="text-rose-400 font-bold">{userStorms.length} imported storms</span> and revert the app to its default state. This action cannot be undone.
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