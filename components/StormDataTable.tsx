import React, { useState } from 'react';
import { Storm } from '../types';
import { STORM_STATUS_COLORS } from '../constants';

interface StormDataTableProps {
  activeStorms: Storm[];
  focusedStormId: string;
  onFocus: (id: string) => void;
}

const HeaderTooltip: React.FC<{ label: string; tooltip: string; align?: 'left' | 'right' | 'center' }> = ({ label, tooltip, align = 'left' }) => (
  <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} group relative cursor-help`}>
    <span className="border-b border-dotted border-slate-600 hover:border-cyan-400 transition-colors">{label}</span>
    
    {/* Tooltip Popup: Rendered BELOW the header (top-full) to avoid overflow clipping */}
    <div className={`
      absolute top-full mt-2 w-48 bg-slate-800 text-slate-200 text-[10px] p-2 rounded shadow-xl border border-slate-600 
      opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 font-normal normal-case leading-relaxed
      ${align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'}
    `}>
      {tooltip}
      {/* Arrow pointing UP */}
      <div className={`
        absolute bottom-full w-0 h-0 border-4 border-transparent border-b-slate-600
        ${align === 'right' ? 'right-4' : 'left-1/2 -translate-x-1/2'}
      `}></div>
    </div>
  </th>
);

const StormDataTable: React.FC<StormDataTableProps> = ({ activeStorms, focusedStormId, onFocus }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
     rmw: true,
     size34: true,
     size50: false, // Default Hidden
     size64: false  // Default Hidden
  });

  const storm = activeStorms.find(s => s.id === focusedStormId);

  const toggleColumn = (key: keyof typeof visibleColumns) => {
     setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getWindIntensityColor = (wind: number) => {
    if (wind >= 137) return 'bg-purple-500/30 text-purple-200'; // Cat 5
    if (wind >= 113) return 'bg-red-500/30 text-red-200'; // Cat 4
    if (wind >= 96) return 'bg-orange-500/30 text-orange-200'; // Cat 3
    if (wind >= 83) return 'bg-yellow-500/30 text-yellow-200'; // Cat 2
    if (wind >= 64) return 'bg-yellow-200/20 text-yellow-100'; // Cat 1
    if (wind >= 34) return 'bg-emerald-500/20 text-emerald-200'; // TS
    return 'text-slate-400';
  };

  const getRecordLabel = (code: string) => {
    switch(code) {
      case 'L': return { label: 'LANDFALL', color: 'bg-emerald-500 text-white' };
      case 'I': return { label: 'PEAK', color: 'bg-indigo-500 text-white' };
      case 'P': return { label: 'MIN PRESS', color: 'bg-rose-500 text-white' };
      case 'S': return { label: 'RAPID CHG', color: 'bg-yellow-500 text-black' };
      case 'T': return { label: 'TRACK', color: 'bg-slate-600 text-slate-200' };
      default: return null;
    }
  };

  const getMaxRad = (radii: any, key: 'ne34' | 'ne50' | 'ne64') => {
     if (!radii) return 0;
     // Map ne34 -> ne34, se34, sw34, nw34
     const suffix = key.substring(2);
     return Math.max(
        radii[`ne${suffix}`] || 0,
        radii[`se${suffix}`] || 0,
        radii[`sw${suffix}`] || 0,
        radii[`nw${suffix}`] || 0
     );
  };

  const handleExportCSV = () => {
    if (!storm || !storm.track) return;

    const headers = [
      'Date', 'Time (UTC)', 'Status', 'Lat', 'Lon', 'Wind (kt)', 'Pressure (mb)', 
      'RMW (nm)', 'Event',
      'NE34', 'SE34', 'SW34', 'NW34',
      'NE50', 'SE50', 'SW50', 'NW50',
      'NE64', 'SE64', 'SW64', 'NW64'
    ];

    const rows = storm.track.map(pt => {
       const r = pt.radii || { 
         ne34:0, se34:0, sw34:0, nw34:0, 
         ne50:0, se50:0, sw50:0, nw50:0, 
         ne64:0, se64:0, sw64:0, nw64:0 
       };
       
       return [
         pt.date,
         pt.time,
         pt.status,
         pt.lat,
         pt.lon,
         pt.maxWind,
         pt.minPressure || '',
         pt.rmw || '',
         pt.recordIdentifier || '',
         r.ne34 || 0, r.se34 || 0, r.sw34 || 0, r.nw34 || 0,
         r.ne50 || 0, r.se50 || 0, r.sw50 || 0, r.nw50 || 0,
         r.ne64 || 0, r.se64 || 0, r.sw64 || 0, r.nw64 || 0,
       ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${storm.id}_${storm.name}_track_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowMenu(false);
  };

  return (
    <div className="w-full bg-slate-900/50 rounded-xl border border-slate-700 overflow-visible shadow-lg backdrop-blur-sm relative flex flex-col">
      
      {/* Tabs Header */}
      <div className="flex items-center bg-slate-800/80 rounded-t-xl border-b border-slate-700 overflow-x-auto scrollbar-hide">
         {activeStorms.length === 0 ? (
             <div className="px-4 py-3 text-xs font-bold uppercase text-slate-500">No Active Storms</div>
         ) : (
             activeStorms.map(s => {
                 const isActive = s.id === focusedStormId;
                 
                 // --- Metadata Calculation for Tab ---
                 const maxWind = s.track.length > 0 ? Math.max(...s.track.map(t => t.maxWind)) : 0;
                 
                 let peakStatus = 'TD';
                 if (maxWind >= 64) peakStatus = 'HU';
                 else if (maxWind >= 34) peakStatus = 'TS';
                 else if (maxWind <= 33) peakStatus = 'TD';

                 let catLabel = 'TD';
                 if (maxWind >= 137) catLabel = 'Cat 5';
                 else if (maxWind >= 113) catLabel = 'Cat 4';
                 else if (maxWind >= 96) catLabel = 'Cat 3';
                 else if (maxWind >= 83) catLabel = 'Cat 2';
                 else if (maxWind >= 64) catLabel = 'Cat 1';
                 else if (maxWind >= 34) catLabel = 'TS';

                 return (
                     <button
                        key={s.id}
                        onClick={() => onFocus(s.id)}
                        className={`
                           px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border-r border-slate-700/50 whitespace-nowrap min-w-[120px] text-center
                           ${isActive 
                               ? 'bg-slate-700/80 text-cyan-400 border-b-2 border-b-cyan-400 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.2)]' 
                               : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 border-b-2 border-b-transparent'}
                        `}
                     >
                        <div className="flex flex-col items-center leading-snug">
                           <div className="flex items-center gap-1.5">
                              <span className="text-sm font-extrabold">{s.name}</span>
                              {peakStatus && <span className={`px-1 rounded text-[9px] ${isActive ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>{peakStatus}</span>}
                           </div>
                           <div className="text-[10px] font-medium opacity-70">
                              {s.year} - {catLabel}
                           </div>
                        </div>
                     </button>
                 );
             })
         )}
      </div>

      {/* Control Bar */}
      <div className="p-3 border-b border-slate-700 bg-slate-800/30 flex justify-between items-center">
        <div className="text-xs text-slate-400 font-mono pl-1">
             {storm ? `Displaying ${storm.dataCount} records` : 'Select a storm to view data'}
        </div>
        
        <div className="flex items-center gap-3 relative">
            <button 
                onClick={() => setShowMenu(!showMenu)}
                disabled={!storm}
                className={`text-slate-500 transition-colors p-1 rounded ${storm ? 'hover:text-cyan-400 hover:bg-slate-700/50' : 'opacity-50 cursor-not-allowed'} ${showMenu ? 'text-cyan-400 bg-slate-700/50' : ''}`}
                title="Table Settings"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>

            {/* Column Toggle Menu */}
            {showMenu && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 p-2 animate-fade-in">
                    <h4 className="text-[10px] uppercase font-bold text-slate-500 mb-2 px-2">Columns</h4>
                    <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer text-xs text-slate-300">
                        <input type="checkbox" checked={visibleColumns.rmw} onChange={() => toggleColumn('rmw')} className="rounded bg-slate-900 border-slate-600 accent-cyan-500" />
                        RMW (Radius Max Wind)
                    </label>
                    <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer text-xs text-slate-300">
                        <input type="checkbox" checked={visibleColumns.size34} onChange={() => toggleColumn('size34')} className="rounded bg-slate-900 border-slate-600 accent-cyan-500" />
                        Size (34kt / Tropical)
                    </label>
                    <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer text-xs text-slate-300">
                        <input type="checkbox" checked={visibleColumns.size50} onChange={() => toggleColumn('size50')} className="rounded bg-slate-900 border-slate-600 accent-cyan-500" />
                        Size (50kt / Storm)
                    </label>
                    <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer text-xs text-slate-300">
                        <input type="checkbox" checked={visibleColumns.size64} onChange={() => toggleColumn('size64')} className="rounded bg-slate-900 border-slate-600 accent-cyan-500" />
                        Size (64kt / Hurricane)
                    </label>

                    <div className="my-2 border-t border-slate-700"></div>
                    <button 
                        onClick={handleExportCSV}
                        className="w-full text-left px-2 py-1.5 hover:bg-slate-700 rounded text-xs text-cyan-400 font-bold flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Export Data (CSV)
                    </button>
                </div>
            )}
        </div>
      </div>
      
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar rounded-b-xl">
        <table className="w-full text-left text-sm text-slate-400">
          <thead className="bg-slate-800 text-xs uppercase font-medium text-slate-300 sticky top-0 z-10 shadow-sm">
            <tr>
              <HeaderTooltip 
                label="Date / Time" 
                tooltip="Date and Time (UTC) of the observation." 
              />
              <HeaderTooltip 
                label="Status" 
                tooltip="System classification (e.g. HU=Hurricane, TS=Tropical Storm)." 
              />
              <HeaderTooltip 
                label="Location" 
                tooltip="Latitude and Longitude of the circulation center." 
              />
              <HeaderTooltip 
                label="Wind (kts)" 
                align="right"
                tooltip="VMAX - Maximum sustained wind speed in knots: 0 - 300 kts." 
              />
              <HeaderTooltip 
                label="Pressure" 
                align="right"
                tooltip="MSLP - Minimum Sea Level Pressure in millibars (lower is stronger)." 
              />
              
              {visibleColumns.rmw && (
                <HeaderTooltip 
                    label="RMW (nm)" 
                    align="right"
                    tooltip="RMW - Radius of Maximum Winds: Distance from center to strongest winds." 
                />
              )}
              {visibleColumns.size34 && (
                <HeaderTooltip 
                    label="Size (34kt)" 
                    align="right"
                    tooltip="Maximum extent of 34 knot (Tropical Storm force) winds." 
                />
              )}
              {visibleColumns.size50 && (
                <HeaderTooltip 
                    label="Size (50kt)" 
                    align="right"
                    tooltip="Maximum extent of 50 knot (Damaging/Storm force) winds." 
                />
              )}
              {visibleColumns.size64 && (
                <HeaderTooltip 
                    label="Size (64kt)" 
                    align="right"
                    tooltip="Maximum extent of 64 knot (Hurricane force) winds." 
                />
              )}
              
              <HeaderTooltip 
                label="Event" 
                align="right"
                tooltip="Key lifecycle events: Landfall (L), Peak Intensity (I), etc." 
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50 font-mono">
            {!storm || storm.track.length === 0 ? (
               <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500 italic">
                      No storm selected. Choose a storm to view data log.
                  </td>
               </tr>
            ) : (
                storm.track.map((point, idx) => {
                  const recordBadge = getRecordLabel(point.recordIdentifier);
                  const rad34 = getMaxRad(point.radii, 'ne34');
                  const rad50 = getMaxRad(point.radii, 'ne50');
                  const rad64 = getMaxRad(point.radii, 'ne64');
                  
                  return (
                    <tr key={`${point.date}-${point.time}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-200">
                        {point.date} <span className="text-slate-500 ml-1">{point.time}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span 
                          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border border-slate-700 shadow-sm"
                          style={{ 
                            backgroundColor: `${STORM_STATUS_COLORS[point.status]}20`, 
                            color: STORM_STATUS_COLORS[point.status],
                            borderColor: `${STORM_STATUS_COLORS[point.status]}40`
                          }}
                        >
                          {point.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-300">
                        {point.originalLat}, {point.originalLon}
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-right font-bold ${getWindIntensityColor(point.maxWind)}`}>
                          {point.maxWind}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className={`${point.minPressure > 0 && point.minPressure < 980 ? 'text-rose-300 font-bold' : 'text-slate-400'}`}>
                          {point.minPressure === 0 ? '-' : point.minPressure}
                        </span>
                      </td>
                      
                      {visibleColumns.rmw && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-slate-400">
                            {point.rmw ? point.rmw : '-'}
                          </td>
                      )}
                      {visibleColumns.size34 && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-slate-400">
                            {rad34 > 0 ? rad34 + 'nm' : '-'}
                          </td>
                      )}
                      {visibleColumns.size50 && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-slate-400">
                            {rad50 > 0 ? <span className="text-yellow-100/70">{rad50}nm</span> : '-'}
                          </td>
                      )}
                      {visibleColumns.size64 && (
                          <td className="px-4 py-3 whitespace-nowrap text-right text-slate-400">
                            {rad64 > 0 ? <span className="text-rose-200/80 font-bold">{rad64}nm</span> : '-'}
                          </td>
                      )}

                      <td className="px-4 py-3 whitespace-nowrap text-right h-10">
                        {recordBadge && (
                           <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${recordBadge.color}`}>
                             {recordBadge.label}
                           </span>
                        )}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StormDataTable;