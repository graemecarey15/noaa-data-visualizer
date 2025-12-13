import React, { useMemo } from 'react';
import { Storm } from '../types';

interface StormSummaryProps {
  storm?: Storm | null;
  identityColor?: string;
}

const StormSummary: React.FC<StormSummaryProps> = ({ storm, identityColor }) => {
  const stats = useMemo(() => {
    if (!storm || !storm.track || storm.track.length === 0) {
      return {
        peakWind: 0,
        minPressure: 0,
        landfalls: [],
        category: 'N/A',
        catColor: 'text-slate-500',
        durationDays: 0
      };
    }

    const winds = storm.track.map(t => t.maxWind);
    const pressures = storm.track.map(t => t.minPressure).filter(p => p > 0);
    
    const peakWind = Math.max(...winds);
    const minPressure = pressures.length > 0 ? Math.min(...pressures) : 0;
    
    const landfalls = storm.track.filter(t => t.recordIdentifier === 'L');
    
    // Category Calculation
    let category = 'Tropical Storm';
    let catColor = 'text-emerald-400';
    if (peakWind < 34) { category = 'Depression'; catColor = 'text-blue-400'; }
    else if (peakWind >= 64 && peakWind < 83) { category = 'Category 1'; catColor = 'text-yellow-400'; }
    else if (peakWind >= 83 && peakWind < 96) { category = 'Category 2'; catColor = 'text-yellow-500'; }
    else if (peakWind >= 96 && peakWind < 113) { category = 'Category 3'; catColor = 'text-orange-400'; }
    else if (peakWind >= 113 && peakWind < 137) { category = 'Category 4'; catColor = 'text-red-400'; }
    else if (peakWind >= 137) { category = 'Category 5'; catColor = 'text-purple-400'; }

    // Duration Calculation
    const start = new Date(storm.track[0].datetime);
    const end = new Date(storm.track[storm.track.length - 1].datetime);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    return {
      peakWind,
      minPressure,
      landfalls,
      category,
      catColor,
      durationDays: diffDays
    };
  }, [storm]);

  const headerColor = identityColor || '#94a3b8';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Peak Intensity Card */}
      <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl shadow-lg backdrop-blur-sm flex flex-col justify-between hover:border-slate-600 transition-colors">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: headerColor }}>
             Peak Intensity
          </p>
          <div className="flex items-baseline gap-2">
            <h4 className={`text-2xl font-bold ${stats.peakWind > 0 ? stats.catColor : 'text-slate-600'}`}>
                {stats.peakWind > 0 ? stats.peakWind : '-'} <span className="text-sm text-slate-400 font-normal">kts</span>
            </h4>
          </div>
        </div>
        <div className={`mt-2 text-xs font-medium px-2 py-1 rounded bg-slate-800 w-fit ${stats.peakWind > 0 ? stats.catColor : 'text-slate-500'}`}>
          {stats.category}
        </div>
      </div>

      {/* Min Pressure Card */}
      <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl shadow-lg backdrop-blur-sm flex flex-col justify-between hover:border-slate-600 transition-colors">
        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: headerColor }}>Min Pressure</p>
        <div className="flex items-baseline gap-2">
          <h4 className={`text-2xl font-bold ${stats.minPressure > 0 ? 'text-rose-400' : 'text-slate-600'}`}>
              {stats.minPressure > 0 ? stats.minPressure : '-'} <span className="text-sm text-slate-400 font-normal">mb</span>
          </h4>
        </div>
        <p className="text-xs text-slate-500 mt-2">Lower is stronger</p>
      </div>

      {/* Landfalls Card */}
      <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl shadow-lg backdrop-blur-sm flex flex-col justify-between hover:border-slate-600 transition-colors">
        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: headerColor }}>Landfalls</p>
        <div className="flex items-baseline gap-2">
          <h4 className={`text-2xl font-bold ${stats.landfalls.length > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{stats.landfalls.length}</h4>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {stats.landfalls.length > 0 ? (
            stats.landfalls.slice(0, 3).map((l, i) => (
               <span key={i} className="text-[10px] bg-emerald-900/50 text-emerald-200 px-1.5 py-0.5 rounded border border-emerald-800">
                 {l.date.slice(5)}
               </span>
            ))
          ) : (
            <span className="text-xs text-slate-500">Oceanic Track</span>
          )}
        </div>
      </div>

      {/* Duration Card */}
      <div className="bg-slate-900/50 border border-slate-700 p-4 rounded-xl shadow-lg backdrop-blur-sm flex flex-col justify-between hover:border-slate-600 transition-colors">
        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: headerColor }}>Duration</p>
        <div className="flex items-baseline gap-2">
          <h4 className={`text-2xl font-bold ${stats.durationDays > 0 ? 'text-blue-400' : 'text-slate-600'}`}>
              {stats.durationDays > 0 ? stats.durationDays : '-'} <span className="text-sm text-slate-400 font-normal">days</span>
          </h4>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {storm && storm.track.length > 0 ? `${storm.track[0].date} — ${storm.track[storm.track.length -1].date}` : 'No Data'}
        </p>
      </div>
    </div>
  );
};

export default StormSummary;