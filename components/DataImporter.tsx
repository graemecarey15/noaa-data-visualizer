import React, { useState, useMemo, useRef, useEffect } from 'react';
import { parseHurdat2 } from '../utils/parser';
import { Storm } from '../types';
import { SAMPLE_HURDAT_DATA, KNOWN_STORM_NAMES, PRELOADED_SEASON_DATA } from '../constants';

export type ImportTab = 'active' | 'archive' | 'file';

interface DataImporterProps {
  onImport: (storms: Storm[]) => void;
  onClose: () => void;
  initialTab?: ImportTab;
}

// Direct link to the latest dataset via CORS proxy
const DEFAULT_URL = "https://corsproxy.io/?https://www.aoml.noaa.gov/hrd/hurdat/hurdat2-1851-2023-051124.txt";
const ATCF_DIR_URL = "https://corsproxy.io/?https://ftp.nhc.noaa.gov/atcf/btk/";
const ATCF_BASE_URL = "https://ftp.nhc.noaa.gov/atcf/btk/";

// Helper for Basin Display (Restricted to US Basins)
const BASIN_LABELS: Record<string, string> = {
  'al': 'Atlantic',
  'ep': 'East Pacific',
  'cp': 'Central Pacific',
};

const BASIN_COLORS: Record<string, string> = {
  'al': 'bg-blue-500/20 text-blue-300 border-blue-500/50',
  'ep': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  'cp': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50',
  'default': 'bg-slate-700 text-slate-300 border-slate-600'
};

const CAT_FILTERS = [
  { label: 'TD', min: 0, max: 33, color: 'border-blue-500 text-blue-400 bg-blue-500/10' },
  { label: 'TS', min: 34, max: 63, color: 'border-emerald-500 text-emerald-400 bg-emerald-500/10' },
  { label: 'C1', min: 64, max: 82, color: 'border-yellow-200 text-yellow-100 bg-yellow-200/10' },
  { label: 'C2', min: 83, max: 95, color: 'border-yellow-500 text-yellow-400 bg-yellow-500/10' },
  { label: 'C3', min: 96, max: 112, color: 'border-orange-500 text-orange-400 bg-orange-500/10' },
  { label: 'C4', min: 113, max: 136, color: 'border-rose-400 text-rose-300 bg-rose-400/10' },
  { label: 'C5', min: 137, max: 999, color: 'border-purple-400 text-purple-300 bg-purple-400/10' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Unified Item Structure for the List View
interface ImportItem {
  id: string; // unique key
  year: number;
  basin: string;
  number: string; // "01", "12"
  displayName: string;
  groupKey: string; // For section headers (Year or Month)
  monthIndex: number; // 0-11 for filtering
  
  // Source Specific
  source: 'atcf' | 'hurdat';
  atcfFilename?: string; // Only for ATCF
  hurdatObj?: Storm; // Only for Archive (Pre-parsed)
  
  // Metadata for Sorting/Filtering
  lastModified?: Date; // For ATCF Sort
  maxWind?: number; // Helper for immediate cache population
}

const DataImporter: React.FC<DataImporterProps> = ({ onImport, onClose, initialTab }) => {
  const [activeTab, setActiveTab] = useState<ImportTab>(initialTab || 'active'); 
  
  // -- Data State --
  const [availableItems, setAvailableItems] = useState<ImportItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Cache (Persisted)
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});
  const [resolvedIntensities, setResolvedIntensities] = useState<Record<string, number>>({});
  
  // Archive Source State
  const [archiveUrl] = useState<string>(DEFAULT_URL);

  // Filters
  const [filterSearch, setFilterSearch] = useState('');
  const [filterYearStart, setFilterYearStart] = useState<number>(2025);
  const [filterYearEnd, setFilterYearEnd] = useState<number>(2025);
  const [filterBasins, setFilterBasins] = useState<Set<string>>(new Set(['al', 'ep', 'cp']));
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [filterMonth, setFilterMonth] = useState<number>(-1); // -1 for All

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Import Progress
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{current: number, total: number} | null>(null);

  // File / Paste Tab
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteData, setPasteData] = useState<string>('');

  // --- 0. LOAD CACHE ---
  useEffect(() => {
    try {
      const cachedNames = localStorage.getItem('hurdat_names_cache');
      if (cachedNames) setResolvedNames(JSON.parse(cachedNames));

      const cachedIntensity = localStorage.getItem('hurdat_intensity_cache');
      if (cachedIntensity) setResolvedIntensities(JSON.parse(cachedIntensity));
    } catch (e) {
      console.warn("Failed to load cache", e);
    }
  }, []);

  // --- 1. SWITCH TABS RESET ---
  useEffect(() => {
    setAvailableItems([]);
    setErrorMsg(null);
    setSelectedIds(new Set());
    
    if (activeTab === 'active') {
       setFilterYearStart(2025);
       setFilterYearEnd(2025);
       scanAtcfDirectory();
    } else if (activeTab === 'archive') {
       // Reset filters to full history for archive
       setFilterYearStart(1851);
       setFilterYearEnd(2024);
       // Auto-load archive immediately
       loadArchive();
    }
  }, [activeTab]);


  // --- 2. ATCF SCANNER ---
  const scanAtcfDirectory = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch(ATCF_DIR_URL);
        if (!res.ok) throw new Error("Failed to connect to NHC server");
        const html = await res.text();
        
        // Regex to capture Filename
        const fileRegex = /href="(b([a-z]{2})(\d{2})(\d{4})\.dat)"/g;
        
        const uniqueMap = new Map<string, ImportItem>();
        const matches = [...html.matchAll(fileRegex)];

        for (const match of matches) {
           const filename = match[1];
           const basin = match[2];
           const num = match[3];
           const year = parseInt(match[4], 10);
           
           // Lookahead for Date
           const lookahead = html.substring(match.index! + match[0].length, match.index! + match[0].length + 300);
           const dateMatch = lookahead.match(/(\d{2}-[A-Za-z]{3}-\d{4})|(\d{4}-\d{2}-\d{2})/);
           
           const id = `${year}-${basin}-${num}`; // Unique Key
           
           if (!uniqueMap.has(id)) {
               let name = `Storm ${num}`;
               if (KNOWN_STORM_NAMES[year.toString()]?.[basin]?.[num]) {
                 name = KNOWN_STORM_NAMES[year.toString()][basin][num];
               } else if (resolvedNames[id]) {
                 name = resolvedNames[id];
               }
               
               let lastModified: Date | undefined = undefined;
               let groupKey = `${year}`;
               let monthIndex = 0;

               if (dateMatch) {
                   lastModified = new Date(dateMatch[0]);
                   if (!isNaN(lastModified.getTime())) {
                       const monthName = lastModified.toLocaleString('default', { month: 'long' });
                       groupKey = `${monthName} ${year}`;
                       monthIndex = lastModified.getMonth();
                   }
               }

               uniqueMap.set(id, {
                 id,
                 year,
                 basin,
                 number: num,
                 displayName: name,
                 lastModified,
                 groupKey,
                 monthIndex,
                 source: 'atcf',
                 atcfFilename: filename
               });
           }
        }

        const files = Array.from(uniqueMap.values());

        // Sort: Year Desc, then by Date Desc
        files.sort((a,b) => {
           if (b.year !== a.year) return b.year - a.year;
           if (a.lastModified && b.lastModified) return b.lastModified.getTime() - a.lastModified.getTime();
           return parseInt(b.number) - parseInt(a.number);
        });

        setAvailableItems(files);
      } catch (e: any) {
        console.error("Directory scan failed", e);
        setErrorMsg(e.message || "Failed to scan directory");
      } finally {
        setIsLoading(false);
      }
  };

  // --- 3. ARCHIVE LOADER ---
  const loadArchive = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
          const url = archiveUrl.includes('corsproxy.io') ? archiveUrl : `https://corsproxy.io/?${archiveUrl}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to fetch archive file");
          const text = await res.text();
          let storms = parseHurdat2(text);
          
          if (storms.length === 0) throw new Error("No storms found in file");

          // Merge 2024 Supplemental Data if not present
          const has2024 = storms.some(s => s.year === 2024);
          if (!has2024) {
             const supplemental = parseHurdat2(PRELOADED_SEASON_DATA);
             storms = [...storms, ...supplemental];
          }

          // Convert parsed storms to ImportItems
          const items: ImportItem[] = storms.map(s => {
              // Extract basin from ID (AL092011 -> AL)
              const basin = s.id.substring(0, 2).toLowerCase();
              const num = s.id.substring(2, 4);
              
              // Calculate Metadata
              const startDate = s.track.length > 0 ? new Date(s.track[0].datetime) : new Date(s.year, 0, 1);
              const monthIndex = startDate.getMonth();
              const monthName = MONTH_NAMES[monthIndex];
              const groupKey = `${monthName} ${s.year}`;
              
              // Pre-fill cache with parsed data so filtering works instantly
              const maxWind = Math.max(...s.track.map(t => t.maxWind));
              
              return {
                  id: s.id,
                  year: s.year,
                  basin: basin,
                  number: num,
                  displayName: s.name,
                  groupKey,
                  monthIndex,
                  source: 'hurdat',
                  hurdatObj: s,
                  maxWind // temporary helper
              };
          });
          
          // Populate Cache immediately for these items
          const newNames: Record<string, string> = {};
          const newIntensities: Record<string, number> = {};
          
          items.forEach(item => {
              newNames[item.id] = item.displayName;
              if (item.maxWind !== undefined) newIntensities[item.id] = item.maxWind;
          });
          
          setResolvedNames(prev => ({...prev, ...newNames}));
          setResolvedIntensities(prev => ({...prev, ...newIntensities}));
          
          // Sort items: Newest first
          items.sort((a,b) => b.year - a.year || parseInt(b.number) - parseInt(a.number));

          setAvailableItems(items);

      } catch(e: any) {
          setErrorMsg(e.message);
      } finally {
          setIsLoading(false);
      }
  };


  // --- 4. BACKGROUND RESOLVER (ATCF ONLY) ---
  useEffect(() => {
      if (activeTab !== 'active' || availableItems.length === 0) return;
      
      const resolveMetadata = async () => {
          const pending = availableItems.filter(f => {
              const needsName = f.displayName.startsWith('Storm ') && !resolvedNames[f.id];
              const needsIntensity = resolvedIntensities[f.id] === undefined;
              return needsName || needsIntensity;
          });

          if (pending.length === 0) return;
          
          // Process a small batch
          const BATCH_SIZE = 5;
          let newResolutions: Record<string, string> = {};
          let newIntensities: Record<string, number> = {};

          for (let i = 0; i < Math.min(pending.length, BATCH_SIZE); i++) {
              const item = pending[i];
              try {
                  const url = `https://corsproxy.io/?${ATCF_BASE_URL}${item.atcfFilename}`;
                  const res = await fetch(url);
                  if (res.ok) {
                      const text = await res.text();
                      const lines = text.split('\n');
                      let bestName = '';
                      let maxWind = 0;

                      for (const line of lines) {
                          const parts = line.split(',').map(p => p.trim());
                          if (parts.length < 10) continue;
                          const wind = parseInt(parts[8], 10);
                          if (!isNaN(wind) && wind > maxWind) maxWind = wind;

                          const nameCands = [parts[27], parts[23]].filter(n => n && isNaN(parseInt(n)));
                          for (const cand of nameCands) {
                              if (!cand) continue;
                              const up = cand.toUpperCase();
                              if (['INVEST', 'GENESIS', 'UNNAMED', 'SUBTROP', 'LOW', 'TC', 'TWO', 'NONAME', 'BEST', 'ONE', 'NINE'].some(bad => up.startsWith(bad))) continue;
                              bestName = cand;
                          }
                      }
                      
                      if (bestName) newResolutions[item.id] = bestName;
                      newIntensities[item.id] = maxWind;
                  }
              } catch (e) {}
          }

          if (Object.keys(newResolutions).length > 0) {
            setResolvedNames(prev => {
              const updated = { ...prev, ...newResolutions };
              localStorage.setItem('hurdat_names_cache', JSON.stringify(updated));
              return updated;
            });
          }
          if (Object.keys(newIntensities).length > 0) {
            setResolvedIntensities(prev => {
                const updated = { ...prev, ...newIntensities };
                localStorage.setItem('hurdat_intensity_cache', JSON.stringify(updated));
                return updated;
            });
          }
      };
      
      const timer = setTimeout(resolveMetadata, 500);
      return () => clearTimeout(timer);
  }, [availableItems, resolvedNames, resolvedIntensities, activeTab]); 


  const toggleBasin = (basin: string) => {
    const next = new Set(filterBasins);
    if (next.has(basin)) next.delete(basin);
    else next.add(basin);
    setFilterBasins(next);
  };

  const toggleCategory = (label: string) => {
    const next = new Set(filterCategories);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setFilterCategories(next);
  };


  // --- 5. UNIFIED FILTER LOGIC ---
  const filteredItems = useMemo(() => {
    return availableItems.filter(item => {
       if (item.year < filterYearStart || item.year > filterYearEnd) return false;
       if (!filterBasins.has(item.basin)) return false;
       if (filterMonth !== -1) {
          if (item.monthIndex !== filterMonth) return false;
       }

       // Category Filter
       if (filterCategories.size > 0) {
           const wind = resolvedIntensities[item.id] || 0;
           let matchesCat = false;
           for (const cat of CAT_FILTERS) {
               if (filterCategories.has(cat.label)) {
                   if (wind >= cat.min && wind <= cat.max) {
                       matchesCat = true;
                       break;
                   }
               }
           }
           // Archive items have intensity immediately. ATCF items might be loading.
           // If Archive: Strict. If ATCF and unknown: Strict (Hide).
           if (resolvedIntensities[item.id] === undefined && filterCategories.size > 0) return false;
           if (!matchesCat) return false;
       }

       const name = resolvedNames[item.id] || item.displayName;
       if (filterSearch) {
          const search = filterSearch.toLowerCase();
          return (
             name.toLowerCase().includes(search) ||
             item.id.toLowerCase().includes(search) ||
             item.year.toString().includes(search)
          );
       }
       return true;
    });
  }, [availableItems, filterYearStart, filterYearEnd, filterBasins, filterCategories, filterSearch, resolvedNames, resolvedIntensities, filterMonth]);

  // Counts for UI
  const monthCounts = useMemo(() => {
    const counts = new Array(12).fill(0);
    // Reuse filter logic but ignore month filter
    availableItems.forEach(item => {
        if (item.year < filterYearStart || item.year > filterYearEnd) return;
        if (!filterBasins.has(item.basin)) return;
        if (filterSearch) {
             const name = resolvedNames[item.id] || item.displayName;
             const search = filterSearch.toLowerCase();
             if (!(name.toLowerCase().includes(search) || item.id.includes(search))) return;
        }
        if (filterCategories.size > 0) {
           const wind = resolvedIntensities[item.id] || 0;
           let matchesCat = false;
           for (const cat of CAT_FILTERS) {
               if (filterCategories.has(cat.label) && wind >= cat.min && wind <= cat.max) matchesCat = true;
           }
           if (!matchesCat) return;
        }
        counts[item.monthIndex]++;
    });
    return counts;
  }, [availableItems, filterYearStart, filterYearEnd, filterBasins, filterSearch, filterCategories, resolvedNames, resolvedIntensities]);

  const categoryCounts = useMemo(() => {
     const counts: Record<string, number> = {};
     CAT_FILTERS.forEach(c => counts[c.label] = 0);
     availableItems.forEach(item => {
        if (item.year < filterYearStart || item.year > filterYearEnd) return;
        if (!filterBasins.has(item.basin)) return;
        if (filterMonth !== -1 && item.monthIndex !== filterMonth) return;
        if (filterSearch) {
             const name = resolvedNames[item.id] || item.displayName;
             const search = filterSearch.toLowerCase();
             if (!(name.toLowerCase().includes(search) || item.id.includes(search))) return;
        }
        const wind = resolvedIntensities[item.id];
        if (wind !== undefined) {
             const cat = CAT_FILTERS.find(c => wind >= c.min && wind <= c.max);
             if (cat) counts[cat.label]++;
        }
     });
     return counts;
  }, [availableItems, filterYearStart, filterYearEnd, filterBasins, filterSearch, filterMonth, resolvedNames, resolvedIntensities]);


  // Group filtered items
  const groupedItems = useMemo(() => {
      const groups: Record<string, ImportItem[]> = {};
      filteredItems.forEach(item => {
          const key = item.groupKey;
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
      });
      return groups;
  }, [filteredItems]);


  // --- 6. SELECTION ---
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
     const allSelected = filteredItems.every(f => selectedIds.has(f.id));
     const next = new Set(selectedIds);
     if (allSelected) {
        filteredItems.forEach(f => next.delete(f.id));
     } else {
        filteredItems.forEach(f => next.add(f.id));
     }
     setSelectedIds(next);
  };

  // --- 7. IMPORT EXECUTION ---
  const handleImport = async (itemsToImport: ImportItem[]) => {
    if (itemsToImport.length === 0) return;

    setImporting(true);
    setImportProgress({ current: 0, total: itemsToImport.length });
    
    const results: Storm[] = [];
    let completed = 0;

    // Separate logic by source
    const atcfItems = itemsToImport.filter(i => i.source === 'atcf');
    const hurdatItems = itemsToImport.filter(i => i.source === 'hurdat');

    // 1. Process Archive (Instant)
    hurdatItems.forEach(item => {
        if (item.hurdatObj) results.push(item.hurdatObj);
        completed++;
    });
    setImportProgress({ current: completed, total: itemsToImport.length });

    // 2. Process ATCF (Fetch)
    if (atcfItems.length > 0) {
        const chunkSize = 5;
        for (let i = 0; i < atcfItems.length; i += chunkSize) {
            const chunk = atcfItems.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (item) => {
               try {
                  const url = `https://corsproxy.io/?${ATCF_BASE_URL}${item.atcfFilename}`;
                  const res = await fetch(url);
                  if (res.ok) {
                     const text = await res.text();
                     const parsed = parseHurdat2(text);
                     results.push(...parsed);
                  }
               } catch (e) { console.error(e); }
               completed++;
               setImportProgress({ current: completed, total: itemsToImport.length });
            }));
        }
    }

    setImporting(false);
    setImportProgress(null);
    setSelectedIds(new Set()); 
    if (results.length > 0) {
       onImport(results);
       onClose();
    } else {
       alert("Failed to import data.");
    }
  };


  // --- 8. FILE UPLOAD ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;
     setFileName(file.name);
     const reader = new FileReader();
     reader.onload = (evt) => {
        try {
           const parsed = parseHurdat2(evt.target?.result as string);
           onImport(parsed);
           onClose();
        } catch(err) { alert("Parse failed"); }
     };
     reader.readAsText(file);
  };
  
  const handlePaste = () => {
     try {
        const parsed = parseHurdat2(pasteData);
        onImport(parsed);
        onClose();
     } catch(e) { alert("Parse failed"); }
  };


  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col h-[85vh] w-full">
      
      {/* --- TABS --- */}
      <div className="flex border-b border-slate-700 bg-slate-950 shrink-0">
        <button
          onClick={() => setActiveTab('active')}
          className={`flex-1 py-4 text-sm font-bold uppercase tracking-wide transition-colors ${
            activeTab === 'active' 
              ? 'bg-slate-900 text-emerald-400 border-b-2 border-emerald-400' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          2025 Best Track (ATCF)
        </button>
        <button
          onClick={() => setActiveTab('archive')}
          className={`flex-1 py-4 text-sm font-bold uppercase tracking-wide transition-colors ${
            activeTab === 'archive' 
              ? 'bg-slate-900 text-cyan-400 border-b-2 border-cyan-400' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          HURDAT2 Archive (1851-2024)
        </button>
        <button
          onClick={() => setActiveTab('file')}
          className={`flex-1 py-4 text-sm font-bold uppercase tracking-wide transition-colors ${
            activeTab === 'file' 
              ? 'bg-slate-900 text-cyan-400 border-b-2 border-cyan-400' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          File / Paste
        </button>
      </div>

      {/* --- CONTENT --- */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        
        {/* === FILE TAB === */}
        {activeTab === 'file' ? (
           <div className="p-6 h-full overflow-y-auto custom-scrollbar">
              <div className="max-w-2xl mx-auto space-y-8">
                 <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-950/30 hover:bg-slate-900/50 transition-colors">
                    <p className="text-slate-300 font-medium mb-2">{fileName || "Upload Local File"}</p>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".txt,.csv,.dat" className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="bg-slate-700 text-white px-4 py-2 rounded">Choose File</button>
                 </div>
                 <div>
                    <h3 className="text-slate-400 text-xs font-bold uppercase mb-2">Paste Raw Data</h3>
                    <textarea value={pasteData} onChange={e => setPasteData(e.target.value)} className="w-full h-40 bg-slate-950 text-slate-300 p-4 rounded border border-slate-700 font-mono text-xs" />
                    <button onClick={handlePaste} className="w-full mt-2 bg-slate-800 text-cyan-400 px-4 py-3 rounded font-bold">Parse Text</button>
                 </div>
              </div>
           </div>
        ) : (
           /* === UNIFIED LIST VIEW (ATCF & ARCHIVE) === */
           <div className="flex flex-col h-full">

              {/* Filter Bar */}
              <div className={`p-4 bg-slate-800/50 border-b border-slate-700 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shrink-0 transition-opacity`}>
                 <div className="flex flex-col gap-3 w-full">
                    {/* Top Row: Search + Year */}
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative flex-1">
                           <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                           </svg>
                           <input 
                              type="text" 
                              placeholder="Search (e.g. Katrina, 2005)..." 
                              value={filterSearch}
                              onChange={e => setFilterSearch(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500"
                           />
                        </div>
                        
                        {/* Year Range (Only for Archive) */}
                        {activeTab === 'archive' && (
                          <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 h-[38px]">
                                   <span className="text-xs text-slate-500 font-bold uppercase">Year</span>
                                   <input 
                                     type="number" 
                                     value={filterYearStart}
                                     onChange={e => setFilterYearStart(parseInt(e.target.value))}
                                     className="bg-transparent w-16 text-center text-sm outline-none text-slate-300 font-mono"
                                   />
                                   <span className="text-slate-600">-</span>
                                   <input 
                                     type="number" 
                                     value={filterYearEnd}
                                     onChange={e => setFilterYearEnd(parseInt(e.target.value))}
                                     className="bg-transparent w-16 text-center text-sm outline-none text-slate-300 font-mono"
                                   />
                              </div>
                              <div className="flex justify-end gap-1">
                                  <button onClick={() => { setFilterYearStart(1851); setFilterYearEnd(2024); }} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors border border-slate-700">All</button>
                                  <button onClick={() => { setFilterYearStart(1979); setFilterYearEnd(2024); }} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors border border-slate-700">1979+</button>
                                  <button onClick={() => { setFilterYearStart(2000); setFilterYearEnd(2024); }} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors border border-slate-700">2000+</button>
                                  <button onClick={() => { setFilterYearStart(2015); setFilterYearEnd(2024); }} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors border border-slate-700">Last 10</button>
                                  <button onClick={() => { setFilterYearStart(2020); setFilterYearEnd(2024); }} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors border border-slate-700">Last 5</button>
                              </div>
                          </div>
                        )}
                    </div>
                    
                    <div className="flex flex-col gap-3">
                       {/* Basin Filters + Month */}
                       <div className="flex flex-wrap gap-2">
                          {Object.entries(BASIN_LABELS).map(([code, label]) => {
                             const isActive = filterBasins.has(code);
                             return (
                                <button
                                   key={code}
                                   onClick={() => toggleBasin(code)}
                                   className={`px-2.5 py-1 text-xs font-bold rounded-full border transition-all ${
                                      isActive 
                                         ? BASIN_COLORS[code] || BASIN_COLORS.default 
                                         : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'
                                   }`}
                                >
                                   {label}
                                </button>
                             );
                          })}
                          
                           <select
                             value={filterMonth}
                             onChange={(e) => setFilterMonth(parseInt(e.target.value, 10))}
                             className="bg-slate-900 text-slate-300 text-xs rounded border border-slate-700 px-2 py-1 outline-none w-full sm:w-auto"
                           >
                             <option value={-1}>All ({availableItems.length > 0 ? availableItems.length : 0})</option>
                             {MONTH_NAMES.map((m, i) => {
                                 const count = monthCounts[i];
                                 if (count === 0) return null;
                                 return (
                                   <option key={m} value={i}>
                                      {m} ({count})
                                   </option>
                                 );
                             })}
                           </select>
                       </div>

                       {/* Category Filters */}
                       <div className="flex flex-wrap gap-2">
                          {CAT_FILTERS.map((cat) => {
                             const isActive = filterCategories.has(cat.label);
                             const count = categoryCounts[cat.label] || 0;
                             
                             return (
                                <button
                                   key={cat.label}
                                   onClick={() => toggleCategory(cat.label)}
                                   className={`px-2.5 py-1 text-[10px] font-bold rounded border transition-all ${
                                      isActive 
                                         ? cat.color
                                         : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'
                                   } ${count === 0 ? 'opacity-40' : 'opacity-100'}`}
                                >
                                   {cat.label} ({count})
                                </button>
                             );
                          })}
                       </div>
                    </div>
                 </div>
              </div>

              {/* Storm List */}
              <div className={`flex-1 overflow-y-auto custom-scrollbar relative bg-slate-950`}>
                 {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 text-cyan-400 z-10 bg-slate-950/80">
                       <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                       <span className="text-sm font-mono">{activeTab === 'archive' ? 'Indexing 170 years of data...' : 'Scanning NHC directory...'}</span>
                    </div>
                 ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                       <p>No storms found matching filters.</p>
                       {errorMsg && <p className="text-rose-400 text-xs mt-2">{errorMsg}</p>}
                    </div>
                 ) : (
                    <div className="w-full text-left text-sm">
                       {/* Header Row */}
                       <div className="bg-slate-900 text-xs font-bold text-slate-400 sticky top-0 z-10 shadow-sm uppercase tracking-wider flex border-b border-slate-800">
                             <div className="px-4 py-3 w-10">
                                <input 
                                   type="checkbox" 
                                   checked={filteredItems.length > 0 && filteredItems.every(f => selectedIds.has(f.id))}
                                   onChange={toggleSelectAll}
                                   className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
                                />
                             </div>
                             <div className="px-4 py-3 flex-1">Storm Name</div>
                             <div className="px-4 py-3 w-24 hidden sm:block">ID</div>
                             <div className="px-4 py-3 w-20 hidden sm:block">Year</div>
                             <div className="px-4 py-3 w-24">Basin</div>
                             <div className="px-4 py-3 w-20 text-right">Wind</div>
                       </div>
                       
                       {/* Groups */}
                       {Object.keys(groupedItems).map(group => (
                          <div key={group}>
                             <div className="px-4 py-2 bg-slate-800/90 text-cyan-400 text-xs font-bold uppercase tracking-widest border-y border-slate-700/80 backdrop-blur sticky top-10 z-0 shadow-sm">
                                {group}
                             </div>
                             <div className="divide-y divide-slate-800/50">
                                {groupedItems[group].map(item => {
                                    const isSelected = selectedIds.has(item.id);
                                    const resolvedName = resolvedNames[item.id] || item.displayName;
                                    const wind = resolvedIntensities[item.id];
                                    
                                    // Determine Category Tag
                                    let catTag = null;
                                    if (wind !== undefined) {
                                       const cat = CAT_FILTERS.find(c => wind >= c.min && wind <= c.max);
                                       if (cat) catTag = cat;
                                    }

                                    return (
                                        <div 
                                          key={item.id} 
                                          className={`flex items-center hover:bg-slate-800/30 transition-colors cursor-pointer ${isSelected ? 'bg-emerald-900/10' : ''}`}
                                          onClick={() => toggleSelection(item.id)}
                                        >
                                           <div className="px-4 py-2.5 w-10 shrink-0" onClick={e => e.stopPropagation()}>
                                              <input 
                                                 type="checkbox" 
                                                 checked={isSelected}
                                                 onChange={() => toggleSelection(item.id)}
                                                 className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
                                              />
                                           </div>
                                           <div className="px-4 py-2.5 flex-1 font-bold text-slate-200 truncate">
                                              {resolvedName}
                                           </div>
                                           <div className="px-4 py-2.5 w-24 font-mono text-slate-400 text-xs uppercase hidden sm:block">
                                              {item.basin}{item.number}
                                           </div>
                                           <div className="px-4 py-2.5 w-20 text-slate-300 hidden sm:block">
                                              {item.year}
                                           </div>
                                           <div className="px-4 py-2.5 w-24">
                                              <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${BASIN_COLORS[item.basin] || BASIN_COLORS.default}`}>
                                                 {BASIN_LABELS[item.basin] || item.basin}
                                              </span>
                                           </div>
                                           <div className="px-4 py-2.5 w-20 text-right">
                                              {catTag ? (
                                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${catTag.color}`}>
                                                      {catTag.label}
                                                  </span>
                                              ) : (
                                                  <span className="text-xs text-slate-600">-</span>
                                              )}
                                           </div>
                                        </div>
                                    );
                                })}
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </div>

              {/* Action Bar */}
              <div className="p-4 bg-slate-900 border-t border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0 shadow-[0_-5px_15px_rgba(0,0,0,0.3)] z-20">
                 <div className="text-slate-400 text-xs">
                    {filteredItems.length} matches • {selectedIds.size} selected
                 </div>
                 <div className="flex gap-3 w-full sm:w-auto">
                    <button
                       onClick={() => handleImport(filteredItems.filter(f => selectedIds.has(f.id)))}
                       disabled={selectedIds.size === 0 || importing}
                       className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2"
                    >
                       {importing ? (
                          <>Importing {importProgress ? `${importProgress.current}/${importProgress.total}` : '...'}</>
                       ) : (
                          <>Import Selected ({selectedIds.size})</>
                       )}
                    </button>
                    <button
                       onClick={() => handleImport(filteredItems)}
                       disabled={filteredItems.length === 0 || importing}
                       className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-slate-200 px-4 py-2.5 rounded-lg font-medium transition-all"
                    >
                       Import All Matching ({filteredItems.length})
                    </button>
                 </div>
              </div>
           </div>
        )}

      </div>
    </div>
  );
};

export default DataImporter;