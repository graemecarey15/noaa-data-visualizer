import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Storm, StormDataPoint } from '../types';
import { getStormPointColor, INTENSITY_COLORS, getCategoryLabel } from '../constants';

interface StormMapProps {
  storm: Storm;
}

// Lightweight World Map GeoJSON URL (Reliable source)
const GEOJSON_URL = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const StormMap: React.FC<StormMapProps> = ({ storm }) => {
  const [worldData, setWorldData] = useState<any>(null);
  const [hoveredPoint, setHoveredPoint] = useState<StormDataPoint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- ZOOM & PAN STATE ---
  const [viewState, setViewState] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // Fetch Map Data once on mount
  useEffect(() => {
    const fetchMap = async () => {
      try {
        const cached = localStorage.getItem('hurdat_world_map');
        if (cached) {
          setWorldData(JSON.parse(cached));
          return;
        }

        const res = await fetch(GEOJSON_URL);
        if (!res.ok) throw new Error("Failed to load map data");
        const data = await res.json();
        
        // Cache it to be nice to the CDN
        try {
          localStorage.setItem('hurdat_world_map', JSON.stringify(data));
        } catch (e) {
          console.warn("Could not cache map data (likely quota exceeded)", e);
        }
        
        setWorldData(data);
      } catch (err) {
        console.error("Map fetch error:", err);
      }
    };
    fetchMap();
  }, []);

  // Reset Zoom when storm changes
  useEffect(() => {
    setViewState({ zoom: 1, panX: 0, panY: 0 });
  }, [storm]);

  // --- MAP PROJECTION LOGIC ---
  // Calculate the "Base" ViewBox (The bounding box of the storm + padding)
  const baseView = useMemo(() => {
    // Default world view if no track
    if (storm.track.length === 0) return { x: -130, y: -60, w: 100, h: 60, pointRadius: 0.5 };

    const lats = storm.track.map(p => p.lat);
    const lons = storm.track.map(p => p.lon);

    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);

    // Padding in degrees (Increased for better context)
    const padding = 15; 
    
    // Ensure minimum dimensions so short tracks don't look huge/distorted
    // and we always see a decent chunk of the map.
    if (maxLat - minLat < 20) {
      const center = (maxLat + minLat) / 2;
      minLat = center - 10;
      maxLat = center + 10;
    }
    if (maxLon - minLon < 20) {
      const center = (maxLon + minLon) / 2;
      minLon = center - 10;
      maxLon = center + 10;
    }

    minLat -= padding;
    maxLat += padding;
    minLon -= padding;
    maxLon += padding;

    const w = maxLon - minLon;
    const h = maxLat - minLat;

    // SVG Coordinate System: X = Lon, Y = -Lat (since SVG Y goes down)
    // Base X is minLon
    // Base Y is -maxLat (the "top" in SVG space corresponds to the highest latitude)
    return {
      x: minLon,
      y: -maxLat,
      w: w,
      h: h,
      pointRadius: Math.max(0.2, w / 150)
    };
  }, [storm]);

  // Calculate "Current" ViewBox based on Zoom/Pan state
  const viewBoxString = useMemo(() => {
    const currentW = baseView.w / viewState.zoom;
    const currentH = baseView.h / viewState.zoom;
    
    // Center the zoom: 
    // New origin = Base Origin + Pan + (Difference in Size / 2)
    const currentX = baseView.x + viewState.panX + (baseView.w - currentW) / 2;
    const currentY = baseView.y + viewState.panY + (baseView.h - currentH) / 2;

    return `${currentX} ${currentY} ${currentW} ${currentH}`;
  }, [baseView, viewState]);

  // --- EVENT HANDLERS ---

  const handleZoomIn = () => {
    setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.5, 50) }));
  };

  const handleZoomOut = () => {
    // Allow zooming out much further (0.1x) to see world context
    setViewState(prev => ({ ...prev, zoom: Math.max(prev.zoom / 1.5, 0.1) }));
  };

  const handleReset = () => {
    setViewState({ zoom: 1, panX: 0, panY: 0 });
  };
  
  const handleWorldView = () => {
     setViewState({ zoom: 0.2, panX: 0, panY: 0 });
  };

  // Wheel Zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!containerRef.current?.contains(e.target as Node)) return;
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    setViewState(prev => {
      // Allow zooming out to 0.1x
      const newZoom = Math.max(0.1, Math.min(50, prev.zoom * scale));
      return { ...prev, zoom: newZoom };
    });
  }, []);

  // Attach non-passive wheel listener to prevent page scroll
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    if (containerRef.current) {
      const { width } = containerRef.current.getBoundingClientRect();
      // Calculate how many degrees per pixel at current zoom
      const currentWidthDegrees = baseView.w / viewState.zoom;
      const degreesPerPixel = currentWidthDegrees / width;

      setViewState(prev => ({
        ...prev,
        // Pan X: dragging right (positive dx) moves map right (decreasing ViewBox X)
        panX: prev.panX - dx * degreesPerPixel,
        // Pan Y: dragging down (positive dy) moves map down (decreasing ViewBox Y, i.e., moving North in Lat terms)
        panY: prev.panY - dy * degreesPerPixel
      }));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // --- RENDER HELPERS ---
  const geoPath = (feature: any) => {
    if (feature.geometry.type === "Polygon") {
      return polygonToPath(feature.geometry.coordinates);
    } else if (feature.geometry.type === "MultiPolygon") {
      return feature.geometry.coordinates.map((poly: any) => polygonToPath(poly)).join(" ");
    }
    return "";
  };

  const polygonToPath = (rings: any[]) => {
    return rings.map((ring: any[]) => {
      if (ring.length === 0) return "";
      const d = `M${ring[0][0]},${-ring[0][1]}`;
      const points = ring.slice(1).map(p => `L${p[0]},${-p[1]}`).join(" ");
      return `${d} ${points} Z`;
    }).join(" ");
  };

  // Adjust point radius based on zoom so they don't get huge
  const visiblePointRadius = baseView.pointRadius / Math.sqrt(Math.max(0.5, viewState.zoom));

  return (
    <div className="w-full h-[500px] bg-slate-900/50 rounded-xl border border-slate-700 shadow-lg backdrop-blur-sm relative overflow-hidden flex flex-col select-none">
      
      {/* Header Overlay */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <h3 className="text-slate-200 font-bold text-lg drop-shadow-md">{storm.name} Track</h3>
        <p className="text-slate-400 text-xs drop-shadow-md">
           {storm.track.length > 0 ? `${storm.track[0].date} - ${storm.track[storm.track.length-1].date}` : ''}
        </p>
      </div>

      {/* Legend Overlay - Saffir-Simpson Scale */}
      <div className="absolute bottom-4 left-4 z-10 bg-slate-900/90 backdrop-blur p-2.5 rounded border border-slate-700 pointer-events-auto hidden sm:block shadow-xl">
         <div className="flex flex-col gap-1.5 text-[10px] text-slate-300 font-medium">
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT5}}></span> Category 5 (&ge;137kt)</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT4}}></span> Category 4</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT3}}></span> Category 3</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT2}}></span> Category 2</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT1}}></span> Category 1</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TS}}></span> Tropical Storm</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TD}}></span> Depression</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.EX}}></span> Extratropical / Low</div>
         </div>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
         <button onClick={handleWorldView} className="bg-slate-800 hover:bg-slate-700 text-cyan-400 p-2 rounded shadow-lg border border-slate-600 transition-colors font-bold text-[10px]" title="World View">
           WORLD
        </button>
        <button onClick={handleReset} className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded shadow-lg border border-slate-600 transition-colors" title="Reset to Storm">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
           </svg>
        </button>
        <button onClick={handleZoomIn} className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded shadow-lg border border-slate-600 transition-colors" title="Zoom In">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
           </svg>
        </button>
        <button onClick={handleZoomOut} className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded shadow-lg border border-slate-600 transition-colors" title="Zoom Out">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
           </svg>
        </button>
      </div>

      {/* Loading State */}
      {!worldData && (
         <div className="absolute inset-0 flex items-center justify-center text-slate-500">
            <span className="animate-pulse">Loading Map Geography...</span>
         </div>
      )}

      {/* The SVG Map */}
      <div 
        className={`flex-1 w-full h-full overflow-hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`} 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg 
          viewBox={viewBoxString} 
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 1. World Map Layer */}
          <g className="map-layer">
            {worldData && worldData.features.map((feature: any, i: number) => (
              <path
                key={i}
                d={geoPath(feature)}
                fill="#1e293b" // slate-800
                stroke="#334155" // slate-700
                strokeWidth={visiblePointRadius * 0.5}
                className="transition-colors hover:fill-slate-700"
              />
            ))}
          </g>

          {/* 3. Storm Track Line */}
          <polyline
            points={storm.track.map(p => `${p.lon},${-p.lat}`).join(" ")}
            fill="none"
            stroke="#64748b" // slate-500
            strokeWidth={visiblePointRadius * 0.5}
            strokeDasharray={`${visiblePointRadius}, ${visiblePointRadius}`}
            opacity={0.4}
          />

          {/* 4. Storm Points */}
          {storm.track.map((p, i) => {
            const pointColor = getStormPointColor(p.maxWind, p.status);
            return (
              <circle
                key={i}
                cx={p.lon}
                cy={-p.lat}
                r={p.recordIdentifier === 'L' ? visiblePointRadius * 1.5 : visiblePointRadius}
                fill={pointColor}
                stroke={p.recordIdentifier === 'L' ? '#10b981' : 'transparent'}
                strokeWidth={visiblePointRadius * 0.3}
                className="transition-all duration-200 hover:opacity-100 cursor-pointer hover:stroke-white/50"
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}

          {/* 5. Highlighted Point Ring */}
          {hoveredPoint && (
             <circle 
                cx={hoveredPoint.lon}
                cy={-hoveredPoint.lat}
                r={visiblePointRadius * 2}
                fill="none"
                stroke="white"
                strokeWidth={visiblePointRadius * 0.2}
                className="animate-ping"
             />
          )}
        </svg>

        {/* Floating Tooltip (HTML overlay) */}
        {hoveredPoint && (
           <div 
             className="absolute bg-slate-800 border border-slate-600 p-2.5 rounded shadow-2xl text-xs z-50 pointer-events-none whitespace-nowrap backdrop-blur-md"
             style={{
                left: '50%',
                top: '10px',
                transform: 'translateX(-50%)'
             }}
           >
              <div className="flex items-center gap-2 border-b border-slate-700 pb-1 mb-1">
                 <span 
                   className="w-2.5 h-2.5 rounded-sm inline-block"
                   style={{ background: getStormPointColor(hoveredPoint.maxWind, hoveredPoint.status) }}
                 ></span>
                 <span className="font-bold text-slate-100 uppercase tracking-wider">
                    {getCategoryLabel(hoveredPoint.maxWind)}
                 </span>
              </div>

              <div className="font-bold text-slate-200">{hoveredPoint.date} {hoveredPoint.time}</div>
              <div className="text-slate-400 font-mono text-[10px] mb-1">Lat: {hoveredPoint.originalLat} Lon: {hoveredPoint.originalLon}</div>
              
              <div className="text-slate-300">
                 {hoveredPoint.status} • <span className="text-cyan-400 font-bold">{hoveredPoint.maxWind} kts</span> • {hoveredPoint.minPressure > 0 ? `${hoveredPoint.minPressure}mb` : ''}
              </div>
              {hoveredPoint.recordIdentifier === 'L' && (
                 <div className="text-emerald-400 font-bold mt-1 text-[10px] tracking-widest bg-emerald-900/30 px-1 py-0.5 rounded w-fit">LANDFALL</div>
              )}
           </div>
        )}
      </div>
      
      <div className="absolute bottom-2 right-2 text-[9px] text-slate-600 pointer-events-none hidden sm:block">
         Data: NOAA HURDAT2 • Map: OpenData
      </div>
    </div>
  );
};

export default StormMap;