import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Line,
  ReferenceLine,
  Label
} from 'recharts';
import { Storm } from '../types';

interface StormChartProps {
  storm?: Storm | null;
  color?: string; // Identity Color
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-800 border border-slate-600 p-3 rounded shadow-xl text-xs z-50">
        <p className="font-bold text-slate-200 mb-1">{label}</p>
        <p style={{ color: payload[0].stroke }}>Wind: {payload[0].value} kts</p>
        {payload[1] && <p className="text-slate-400">Pressure: {payload[1].value} mb</p>}
        <div className="mt-2 pt-2 border-t border-slate-700">
          <p className="text-slate-400">Status: {data.status}</p>
          {data.recordIdentifier && (
             <p className="text-emerald-400 font-bold">Event: {data.recordIdentifier === 'L' ? 'Landfall' : data.recordIdentifier}</p>
          )}
          <p className="text-slate-500">({data.originalLat}, {data.originalLon})</p>
        </div>
      </div>
    );
  }
  return null;
};

const StormChart: React.FC<StormChartProps> = ({ storm, color = '#22d3ee' }) => {
  if (!storm) {
     return (
        <div className="w-full h-[350px] bg-slate-900/50 rounded-xl border border-slate-700 p-4 shadow-lg backdrop-blur-sm flex items-center justify-center">
            <div className="text-center text-slate-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
                <p>Select a storm to view intensity profile</p>
            </div>
        </div>
     );
  }

  const data = storm.track.map(point => ({
    ...point,
    displayDate: `${point.date.slice(5)} ${point.time}`
  }));

  return (
    <div className="w-full h-[350px] bg-slate-900/50 rounded-xl border border-slate-700 p-4 shadow-lg backdrop-blur-sm">
      <h3 className="text-slate-300 font-semibold mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
         <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></span>
         Intensity Profile
      </h3>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
          <defs>
            <linearGradient id="colorWind" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          
          <XAxis 
            dataKey="displayDate" 
            stroke="#94a3b8" 
            tick={{fontSize: 10}} 
            tickLine={false}
            minTickGap={30}
          />
          
          <YAxis 
            yAxisId="left" 
            stroke={color} 
            tick={{fontSize: 10}} 
            domain={[0, 'auto']}
            label={{ value: 'Wind (kts)', angle: -90, position: 'insideLeft', fill: color, fontSize: 10 }}
          />
          
          <YAxis 
            yAxisId="right" 
            orientation="right" 
            stroke="#94a3b8" 
            domain={['auto', 'auto']} 
            tick={{fontSize: 10}}
            label={{ value: 'Pressure (mb)', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 10 }}
          />
          
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '40px' }} />
          
          {/* Saffir-Simpson Category Reference Lines */}
          <ReferenceLine yAxisId="left" y={64} stroke="#facc15" strokeDasharray="3 3" opacity={0.5}>
            <Label value="Cat 1" position="insideTopLeft" fill="#facc15" fontSize={10} />
          </ReferenceLine>
          <ReferenceLine yAxisId="left" y={96} stroke="#fb923c" strokeDasharray="3 3" opacity={0.5}>
            <Label value="Cat 3" position="insideTopLeft" fill="#fb923c" fontSize={10} />
          </ReferenceLine>
          <ReferenceLine yAxisId="left" y={137} stroke="#f87171" strokeDasharray="3 3" opacity={0.5}>
            <Label value="Cat 5" position="insideTopLeft" fill="#f87171" fontSize={10} />
          </ReferenceLine>

          <Area 
            yAxisId="left"
            type="monotone" 
            dataKey="maxWind" 
            name="Max Wind (knots)" 
            stroke={color} 
            fillOpacity={1} 
            fill="url(#colorWind)" 
          />
          
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey="minPressure" 
            name="Min Pressure (mb)" 
            stroke="#94a3b8" 
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false} 
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StormChart;