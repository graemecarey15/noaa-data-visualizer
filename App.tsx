

import React, { useState, useEffect, useMemo } from 'react';
import { parseHurdat2 } from './utils/parser';
import { SAMPLE_HURDAT_DATA, PRELOADED_SEASON_DATA } from './constants';
import { Storm } from './types';
import StormChart from './components/StormChart';
import StormMap from './components/StormMap';
import StormDataTable from './components/StormDataTable';
import StormSummary from './components/StormSummary';
import DataImporter from './components/DataImporter';

const App: React.FC = () => {
  // We keep two sets of data:
  // 1. Defaults (Static/Preloaded)
  // 2. User Imports (Persisted in LocalStorage)
  const [defaultStorms, setDefaultStorms] = useState<Storm[]>([]);
  const [userStorms, setUserStorms] = useState<Storm[]>([]);
  
  // State for View
  const [selectedStormId, setSelectedStormId] = useState<string>('');
  const [showInput, setShowInput] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Reset Confirmation State
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  
  // View Filters
  const [filterName, setFilterName] = useState<string>('');
  const [filterYearStart, setFilterYearStart] = useState<number>(0);
  const [filterYearEnd, setFilterYearEnd] = useState<number>(0);
  const [hideUnnamed, setHideUnnamed] = useState<boolean>(false);

  // 1. Load Data & State on Mount
  useEffect(() => {
    const initApp = () => {
      try {
        // A. Load Defaults
        const sampleParsed = parseHurdat2(SAMPLE_HURDAT_DATA);
        const preloadedParsed = parseHurdat2(PRELOADED_SEASON_DATA);
        setDefaultStorms([...sampleParsed, ...preloadedParsed]);

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
    const all = [...userStorms, ...activeDefaults];
    
    return all.sort((a,b) => {
       if (b.year !== a.year) return b.year - a.year;
       return b.id.localeCompare(a.id);
    });
  }, [defaultStorms, userStorms]);

  // Auto-Select Logic (Only runs if no selection exists after hydration)
  useEffect(() => {
    if (isHydrated && !selectedStormId && storms.length > 0) {
      setSelectedStormId(storms[0].id);
    }
  }, [storms, selectedStormId, isHydrated]);


  // Determine Data Bounds
  const { dataMinYear, dataMaxYear } = useMemo(() => {
    const currentYear = new Date().getFullYear();
    if (storms.length === 0) return { dataMinYear: 1851, dataMaxYear: currentYear + 1 };
    
    const years = storms.map(s => s.year);
    // Allow range to extend to current year even if data is old
    const max = Math.max(...years, currentYear);
    const min = Math.min(...years);
    return { 
      dataMinYear: min, 
      dataMaxYear: max 
    };
  }, [storms]);

  // Sync filters to data bounds
  useEffect(() => {
    // Only set defaults if filters are untouched (0)
    if (filterYearStart === 0) setFilterYearStart(dataMinYear);
    if (filterYearEnd === 0) setFilterYearEnd(dataMaxYear);
  }, [dataMinYear, dataMaxYear, filterYearStart, filterYearEnd]);

  // Handle new data from importer
  const handleDataImport = (newStorms: Storm[]) => {
    setUserStorms(prev => {
      const newIds = new Set(newStorms.map(s => s.id));
      const keptOld = prev.filter(s => !newIds.has(s.id));
      return [...keptOld, ...newStorms];
    });

    if (newStorms.length > 0) {
      // Auto-select the first of the newly imported storms
      setSelectedStormId(newStorms[0].id);
    }
    setShowInput(false);
  };

  const handleManualSave = () => {
    setSaveStatus('saving');
    // Promote all currently visible storms (including defaults) to User Storms
    // This effectively snapshots the current workspace
    setUserStorms(storms);
    
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  const executeReset = () => {
    // 1. Clear State
    setUserStorms([]);
    
    // 2. Reset Filters so default data is visible immediately
    setFilterYearStart(0);
    setFilterYearEnd(0);
    setFilterName('');
    setHideUnnamed(false);

    // 3. Force Clear Storage
    setTimeout(() => {
        localStorage.removeItem('hurdat_user_storms');
    }, 0);

    // 4. Revert to default selection
    if (defaultStorms.length > 0) setSelectedStormId(defaultStorms[0].id);
    else setSelectedStormId('');
    
    setShowResetModal(false);
  };

  // Helper to calculate max intensity label
  const getStormIntensityLabel = (storm: Storm) => {
    if (!storm.track || storm.track.length === 0) return 'N/A';
    const maxWind = Math.max(...storm.track.map(t => t.maxWind));
    
    if (maxWind >= 137) return 'Category 5';
    if (maxWind >= 113) return 'Category 4';
    if (maxWind >= 96) return 'Category 3';
    if (maxWind >= 83) return 'Category 2';
    if (maxWind >= 64) return 'Category 1';
    if (maxWind >= 34) return 'Tropical Storm';
    return 'Depression';
  };

  // Filter Logic
  const filteredStorms = useMemo(() => {
    return storms.filter(s => {
      if (s.year < filterYearStart || s.year > filterYearEnd) return false;
      if (filterName && !s.name.includes(filterName.toUpperCase())) return false;
      if (hideUnnamed && s.name === 'UNNAMED') return false;
      return true;
    });
  }, [storms, filterYearStart, filterYearEnd, filterName, hideUnnamed]);

  const selectedStorm = useMemo(() => 
    storms.find(s => s.id === selectedStormId), 
  [storms, selectedStormId]);

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
              onClick={() => setShowInput(true)}
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
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        
        {/* Control Bar */}
        <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl backdrop-blur-sm flex flex-col md:flex-row gap-4 justify-between items-center shadow-lg">
          
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
             <div className="relative group">
                <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input 
                  type="text" 
                  placeholder="Search Storm..." 
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 w-full sm:w-48"
                />
             </div>

             <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                <input 
                  type="number" 
                  value={filterYearStart}
                  onChange={(e) => setFilterYearStart(Number(e.target.value))}
                  className="bg-transparent w-16 text-center text-sm outline-none text-slate-300"
                />
                <span className="text-slate-600">-</span>
                <input 
                  type="number" 
                  value={filterYearEnd}
                  onChange={(e) => setFilterYearEnd(Number(e.target.value))}
                  className="bg-transparent w-16 text-center text-sm outline-none text-slate-300"
                />
             </div>
             
             <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none px-2">
                <input 
                   type="checkbox" 
                   checked={hideUnnamed}
                   onChange={(e) => setHideUnnamed(e.target.checked)}
                   className="accent-cyan-500"
                />
                Hide Unnamed
             </label>
          </div>

          {/* Storm Selector */}
          <div className="w-full md:w-1/3">
            <select
              value={selectedStormId}
              onChange={(e) => setSelectedStormId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent p-2.5 outline-none shadow-inner"
            >
              {filteredStorms.length === 0 && <option value="">No matches found</option>}
              {filteredStorms.map((storm) => (
                <option key={storm.id} value={storm.id}>
                  {storm.year} — {storm.name} ({getStormIntensityLabel(storm)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedStorm ? (
          <div className="space-y-6 animate-fade-in">
            {/* Top Row: Summary Stats */}
            <StormSummary storm={selectedStorm} />

            {/* Middle Row: Map & Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-2">
                <StormMap storm={selectedStorm} />
              </div>
              <div className="space-y-2">
                <StormChart storm={selectedStorm} />
              </div>
            </div>

            {/* Bottom Row: Data Table */}
            <StormDataTable storm={selectedStorm} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
             <p>Select a storm or adjust filters to view data</p>
          </div>
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
            <DataImporter onImport={handleDataImport} onClose={() => setShowInput(false)} />
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