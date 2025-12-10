import React from 'react';
import { Storm } from '../types';
import { STORM_STATUS_COLORS } from '../constants';

interface StormDataTableProps {
  storm: Storm;
}

const StormDataTable: React.FC<StormDataTableProps> = ({ storm }) => {
  
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

  return (
    <div className="w-full bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden shadow-lg backdrop-blur-sm">
      <div className="p-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
        <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider">Detailed Data Log</h3>
        <span className="text-xs text-slate-500 font-mono">{storm.dataCount} Records</span>
      </div>
      
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-left text-sm text-slate-400">
          <thead className="bg-slate-800 text-xs uppercase font-medium text-slate-300 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3">Date / Time</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3 text-right">Wind (kts)</th>
              <th className="px-4 py-3 text-right">Pressure (mb)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50 font-mono">
            {storm.track.map((point, idx) => {
              const recordBadge = getRecordLabel(point.recordIdentifier);
              return (
                <tr key={`${point.date}-${point.time}-${idx}`} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-200">
                    {point.date} <span className="text-slate-500 ml-1">{point.time}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap h-10">
                    {recordBadge && (
                       <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ${recordBadge.color}`}>
                         {recordBadge.label}
                       </span>
                    )}
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
                  <td className={`px-4 py-3 whitespace-nowrap text-right font-medium ${getWindIntensityColor(point.maxWind)}`}>
                      {point.maxWind}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <span className={`${point.minPressure > 0 && point.minPressure < 980 ? 'text-rose-300 font-bold' : 'text-slate-400'}`}>
                      {point.minPressure === 0 ? '-' : point.minPressure}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StormDataTable;