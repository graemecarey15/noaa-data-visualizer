
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { parseHurdat2 } from '../utils/parser';
import { Storm } from '../types';
import { SAMPLE_HURDAT_DATA, KNOWN_STORM_NAMES } from '../constants';

interface DataImporterProps {
  onImport: (storms: Storm[]) => void;
  onClose: () => void;
}

type ImportTab = 'active' | 'archive' | 'file';

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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface StormFile {
  id: string; // unique key (year-basin-num)
  year: number;
  basin: string;
  number: string;
  filename: string;
  displayName: string;
  lastModified?: Date;
  monthGroup?: string;
}

const DataImporter: React.FC<DataImporterProps> = ({ onImport, onClose }) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('active'); 
  
  // -- State for Active/Live Tab --
  const [allFiles, setAllFiles] = useState<StormFile[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  // Name Cache (Persisted)
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});
  
  // Filters
  const [filterSearch, setFilterSearch] = useState('');
  // Default to 2025 and lock it there for the UI
  const [filterYearStart, setFilterYearStart] = useState<number>(2025);
  const [filterYearEnd, setFilterYearEnd] = useState<number>(2025);
  const [filterBasins, setFilterBasins] = useState<Set<string>>(new Set(['al', 'ep', 'cp']));
  const [filterMonth, setFilterMonth] = useState<number>(-1); // -1 for All

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Import Progress
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{current: number, total: number} | null>(null);

  // -- State for Archive/File Tabs --
  const [fetchUrl, setFetchUrl] = useState<string>(DEFAULT_URL);
  const [isFetchingArchive, setIsFetchingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteData, setPasteData] = useState<string>('');

  // --- 0. LOAD CACHE ---
  useEffect(() => {
    try {
      const cached = localStorage.getItem('hurdat_names_cache');
      if (cached) {
        setResolvedNames(JSON.parse(cached));
      }
    } catch (e) {
      console.warn("Failed to load name cache", e);
    }
  }, []);

  // --- 1. DIRECTORY SCANNER ---
  useEffect(() => {
    const scanDirectory = async () => {
      if (activeTab !== 'active' || allFiles.length > 0) return;
      
      setIsScanning(true);
      setScanError(null);
      try {
        const res = await fetch(ATCF_DIR_URL);
        if (!res.ok) throw new Error("Failed to connect to NHC server");
        const html = await res.text();
        
        // Regex to capture Filename
        const fileRegex = /href="(b([a-z]{2})(\d{2})(\d{4})\.dat)"/g;
        
        const uniqueMap = new Map<string, StormFile>();
        const matches = [...html.matchAll(fileRegex)];

        for (const match of matches) {
           const filename = match[1];
           const basin = match[2];
           const num = match[3];
           const year = parseInt(match[4], 10);
           
           // Lookahead for Date
           // Supports: 20-Jun-2024 (Apache) OR 2024-06-20 (ISO)
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
               // Fallback group if date not found
               let monthGroup = `${year} ${BASIN_LABELS[basin] || basin.toUpperCase()}`;

               if (dateMatch) {
                   // dateMatch[0] is the full match (either format)
                   lastModified = new Date(dateMatch[0]);
                   if (!isNaN(lastModified.getTime())) {
                       const monthName = lastModified.toLocaleString('default', { month: 'long' });
                       monthGroup = `${monthName} ${year}`;
                   }
               }

               uniqueMap.set(id, {
                 id,
                 year,
                 basin,
                 number: num,
                 filename,
                 displayName: name,
                 lastModified,
                 monthGroup
               });
           }
        }

        const files = Array.from(uniqueMap.values());

        // Sort: Year Desc, then by Date Desc (Newest Month First), then Number Desc
        files.sort((a,b) => {
           if (b.year !== a.year) return b.year - a.year;
           if (a.lastModified && b.lastModified) return b.lastModified.getTime() - a.lastModified.getTime();
           // If no date, try to infer relative order by number (usually higher number = later)
           return parseInt(b.number) - parseInt(a.number);
        });

        setAllFiles(files);
        
      } catch (e: any) {
        console.error("Directory scan failed", e);
        setScanError(e.message || "Failed to scan directory");
      } finally {
        setIsScanning(false);
      }
    };

    scanDirectory();
  }, [activeTab, resolvedNames]); 


  // --- 1b. BACKGROUND NAME RESOLVER ---
  useEffect(() => {
      if (allFiles.length === 0) return;
      const resolveNames = async () => {
          const pending = allFiles.filter(f => 
              f.displayName.startsWith('Storm ') && !resolvedNames[f.id]
          );
          if (pending.length === 0) return;
          const BATCH_SIZE = 5;
          let newResolutions: Record<string, string> = {};
          for (let i = 0; i < pending.length; i += BATCH_SIZE) {
              const batch = pending.slice(i, i + BATCH_SIZE);
              await Promise.all(batch.map(async (file) => {
                  try {
                      const url = `https://corsproxy.io/?${ATCF_BASE_URL}${file.filename}`;
                      const res = await fetch(url);
                      if (res.ok) {
                          const text = await res.text();
                          const lines = text.split('\n');
                          let bestName = '';
                          for (const line of lines) {
                              const parts = line.split(',').map(p => p.trim());
                              if (parts.length < 10) continue;
                              const nameCands = [parts[27], parts[23]].filter(n => n && isNaN(parseInt(n)));
                              for (const cand of nameCands) {
                                  if (!cand) continue;
                                  const up = cand.toUpperCase();
                                  if (['INVEST', 'GENESIS', 'UNNAMED', 'SUBTROP', 'LOW', 'TC', 'TWO', 'NONAME', 'BEST', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'].some(bad => up.startsWith(bad))) {
                                      continue;
                                  }
                                  bestName = cand;
                              }
                          }
                          if (bestName) newResolutions[file.id] = bestName;
                      }
                  } catch (e) {}
              }));
          }
          if (Object.keys(newResolutions).length > 0) {
            setResolvedNames(prev => {
              const updated = { ...prev, ...newResolutions };
              localStorage.setItem('hurdat_names_cache', JSON.stringify(updated));
              return updated;
            });
          }
      };
      const timer = setTimeout(resolveNames, 500);
      return () => clearTimeout(timer);
  }, [allFiles]); 


  // --- 2. FILTER LOGIC ---
  const filteredFiles = useMemo(() => {
    return allFiles.filter(f => {
       if (f.year < filterYearStart || f.year > filterYearEnd) return false;
       if (!filterBasins.has(f.basin)) return false;
       if (filterMonth !== -1) {
          if (!f.lastModified) return false;
          if (f.lastModified.getMonth() !== filterMonth) return false;
       }

       const name = resolvedNames[f.id] || f.displayName;
       if (filterSearch) {
          const search = filterSearch.toLowerCase();
          return (
             name.toLowerCase().includes(search) ||
             f.id.includes(search) ||
             f.year.toString().includes(search)
          );
       }
       return true;
    });
  }, [allFiles, filterYearStart, filterYearEnd, filterBasins, filterSearch, resolvedNames, filterMonth]);

  // Compute counts per month based on current Year/Basin/Search filters
  const monthCounts = useMemo(() => {
    const counts = new Array(12).fill(0);
    allFiles.forEach(f => {
       // Apply same logic as filters EXCEPT month
       if (f.year < filterYearStart || f.year > filterYearEnd) return;
       if (!filterBasins.has(f.basin)) return;
       const name = resolvedNames[f.id] || f.displayName;
       if (filterSearch) {
          const search = filterSearch.toLowerCase();
          const matches = name.toLowerCase().includes(search) ||
                          f.id.includes(search) ||
                          f.year.toString().includes(search);
          if (!matches) return;
       }

       // Increment count for this file's month
       if (f.lastModified) {
         counts[f.lastModified.getMonth()]++;
       }
    });
    return counts;
  }, [allFiles, filterYearStart, filterYearEnd, filterBasins, filterSearch, resolvedNames]);


  // Group filtered files by Month
  const groupedFiles = useMemo(() => {
      const groups: Record<string, StormFile[]> = {};
      filteredFiles.forEach(f => {
          // Key is Month Group. If duplicated months exist across years, the year is already part of the string.
          const key = f.monthGroup || `${f.year} Season`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(f);
      });
      return groups;
  }, [filteredFiles]);

  const toggleBasin = (basin: string) => {
    const next = new Set(filterBasins);
    if (next.has(basin)) next.delete(basin);
    else next.add(basin);
    setFilterBasins(next);
  };

  // --- 3. SELECTION LOGIC ---
  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
     const allSelected = filteredFiles.every(f => selectedIds.has(f.id));
     const next = new Set(selectedIds);
     if (allSelected) {
        filteredFiles.forEach(f => next.delete(f.id));
     } else {
        filteredFiles.forEach(f => next.add(f.id));
     }
     setSelectedIds(next);
  };

  // --- 4. IMPORT ACTIONS ---
  const handleImport = async (filesToImport: StormFile[]) => {
    if (filesToImport.length === 0) return;

    setImporting(true);
    setImportProgress({ current: 0, total: filesToImport.length });
    
    const results: Storm[] = [];
    let completed = 0;
    const fetchOne = async (file: StormFile) => {
       try {
          const url = `https://corsproxy.io/?${ATCF_BASE_URL}${file.filename}`;
          const res = await fetch(url);
          if (res.ok) {
             const text = await res.text();
             return parseHurdat2(text);
          }
       } catch (e) { console.error(e); }
       return [];
    };

    const chunkSize = 5;
    for (let i = 0; i < filesToImport.length; i += chunkSize) {
        const chunk = filesToImport.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (file) => {
           const storms = await fetchOne(file);
           results.push(...storms);
           completed++;
           setImportProgress({ current: completed, total: filesToImport.length });
        }));
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

  // --- 5. ARCHIVE HANDLERS ---
  const handleArchiveFetch = async () => {
    setIsFetchingArchive(true);
    setArchiveError(null);
    try {
      const url = fetchUrl.includes('corsproxy.io') ? fetchUrl : `https://corsproxy.io/?${fetchUrl}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch archive");
      const text = await res.text();
      const parsed = parseHurdat2(text);
      if (parsed.length === 0) throw new Error("No valid data found");
      onImport(parsed);
      onClose();
    } catch (e: any) { setArchiveError(e.message); } 
    finally { setIsFetchingArchive(false); }
  };

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
          HURDAT2 Archive (1851-2023)
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

      {/* --- CONTENT AREA --- */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        
        {/* === TAB 1: LIVE / ATCF LIST === */}
        {activeTab === 'active' && (
           <div className="flex flex-col h-full">
              
              {/* Filter Bar */}
              <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shrink-0">
                 <div className="flex flex-col gap-3 w-full">
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative flex-1">
                           <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                           </svg>
                           <input 
                              type="text" 
                              placeholder="Search (e.g. Milton, AL09)..." 
                              value={filterSearch}
                              onChange={e => setFilterSearch(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
                           />
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
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
                       </div>
                       
                       {/* Month Picker with Counts */}
                       <select
                         value={filterMonth}
                         onChange={(e) => setFilterMonth(parseInt(e.target.value, 10))}
                         className="bg-slate-900 text-slate-300 text-xs rounded border border-slate-700 px-2 py-1 outline-none w-full sm:w-auto"
                       >
                         <option value={-1}>All Months ({allFiles.filter(f => !filterBasins.has(f.basin) ? false : (filterSearch ? (resolvedNames[f.id] || f.displayName).toLowerCase().includes(filterSearch.toLowerCase()) : true)).length})</option>
                         {MONTH_NAMES.map((m, i) => {
                             const count = monthCounts[i];
                             if (count === 0) return null; // Hide months without storms
                             return (
                               <option key={m} value={i}>
                                  {m} ({count})
                               </option>
                             );
                         })}
                       </select>
                    </div>
                 </div>
              </div>

              {/* Storm List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar relative bg-slate-950">
                 {isScanning ? (
                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 text-emerald-400">
                       <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                       </svg>
                       <span className="text-sm font-mono">Indexing NHC Server...</span>
                    </div>
                 ) : filteredFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                       <p>No storms found matching filters.</p>
                       {scanError && <p className="text-rose-400 text-xs mt-2">{scanError}</p>}
                    </div>
                 ) : (
                    <div className="w-full text-left text-sm">
                       {/* Header Row */}
                       <div className="bg-slate-900 text-xs font-bold text-slate-400 sticky top-0 z-10 shadow-sm uppercase tracking-wider flex border-b border-slate-800">
                             <div className="px-4 py-3 w-10">
                                <input 
                                   type="checkbox" 
                                   checked={filteredFiles.length > 0 && filteredFiles.every(f => selectedIds.has(f.id))}
                                   onChange={toggleSelectAll}
                                   className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
                                />
                             </div>
                             <div className="px-4 py-3 flex-1">Storm Name</div>
                             <div className="px-4 py-3 w-24 hidden sm:block">ID</div>
                             <div className="px-4 py-3 w-20 hidden sm:block">Year</div>
                             <div className="px-4 py-3 w-32">Basin</div>
                       </div>
                       
                       {/* Groups */}
                       {Object.keys(groupedFiles).map(group => (
                          <div key={group}>
                             <div className="px-4 py-2 bg-slate-800/90 text-cyan-400 text-xs font-bold uppercase tracking-widest border-y border-slate-700/80 backdrop-blur sticky top-10 z-0 shadow-sm">
                                {group}
                             </div>
                             <div className="divide-y divide-slate-800/50">
                                {groupedFiles[group].map(file => {
                                    const isSelected = selectedIds.has(file.id);
                                    const resolvedName = resolvedNames[file.id] || file.displayName;
                                    return (
                                        <div 
                                          key={file.id} 
                                          className={`flex items-center hover:bg-slate-800/30 transition-colors cursor-pointer ${isSelected ? 'bg-emerald-900/10' : ''}`}
                                          onClick={() => toggleSelection(file.id)}
                                        >
                                           <div className="px-4 py-2.5 w-10 shrink-0" onClick={e => e.stopPropagation()}>
                                              <input 
                                                 type="checkbox" 
                                                 checked={isSelected}
                                                 onChange={() => toggleSelection(file.id)}
                                                 className="rounded border-slate-600 bg-slate-800 accent-emerald-500"
                                              />
                                           </div>
                                           <div className="px-4 py-2.5 flex-1 font-bold text-slate-200 truncate">
                                              {resolvedName}
                                           </div>
                                           <div className="px-4 py-2.5 w-24 font-mono text-slate-400 text-xs uppercase hidden sm:block">
                                              {file.basin}{file.number}
                                           </div>
                                           <div className="px-4 py-2.5 w-20 text-slate-300 hidden sm:block">
                                              {file.year}
                                           </div>
                                           <div className="px-4 py-2.5 w-32">
                                              <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${BASIN_COLORS[file.basin] || BASIN_COLORS.default}`}>
                                                 {BASIN_LABELS[file.basin] || file.basin}
                                              </span>
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
                    {filteredFiles.length} matches • {selectedIds.size} selected
                 </div>
                 <div className="flex gap-3 w-full sm:w-auto">
                    <button
                       onClick={() => handleImport(filteredFiles.filter(f => selectedIds.has(f.id)))}
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
                       onClick={() => handleImport(filteredFiles)}
                       disabled={filteredFiles.length === 0 || importing}
                       className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-slate-200 px-4 py-2.5 rounded-lg font-medium transition-all"
                    >
                       Import All Matching ({filteredFiles.length})
                    </button>
                 </div>
              </div>
           </div>
        )}

        {/* === TAB 2: ARCHIVE === */}
        {activeTab === 'archive' && (
           <div className="p-6 flex flex-col items-center justify-center h-full">
              <div className="max-w-xl w-full bg-slate-950 p-6 rounded-xl border border-slate-700">
                 <h3 className="text-lg font-bold text-cyan-400 mb-2">HURDAT2 Archive</h3>
                 <p className="text-slate-400 text-sm mb-6">Load the complete historical record (1851-2023) from the NOAA HRD server. This is a large file (~10MB).</p>
                 
                 <div className="flex gap-2">
                    <input 
                       type="text" 
                       value={fetchUrl} 
                       onChange={e => setFetchUrl(e.target.value)}
                       className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200"
                    />
                    <button 
                       onClick={handleArchiveFetch}
                       disabled={isFetchingArchive}
                       className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded font-bold"
                    >
                       {isFetchingArchive ? 'Loading...' : 'Fetch'}
                    </button>
                 </div>
                 {archiveError && <p className="text-rose-400 text-sm mt-3">{archiveError}</p>}
              </div>
           </div>
        )}

        {/* === TAB 3: FILE === */}
        {activeTab === 'file' && (
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
        )}

      </div>
    </div>
  );
};

export default DataImporter;
