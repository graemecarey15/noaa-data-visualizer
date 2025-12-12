
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Storm, StormDataPoint, WindRadii } from '../types';
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

  // --- LAYER STATE ---
  const [showLayersMenu, setShowLayersMenu] = useState(false);
  const [layers, setLayers] = useState({
     track: true,
     points: true,
     windStructure: false, // Default Off as requested
  });

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
  const baseView = useMemo(() => {
    if (storm.track.length === 0) return { x: -130, y: -60, w: 100, h: 60, pointRadius: 0.5 };

    const lats = storm.track.map(p => p.lat);
    const lons = storm.track.map(p => p.lon);

    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);

    const padding = 15; 
    
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

    return {
      x: minLon,
      y: -maxLat,
      w: w,
      h: h,
      pointRadius: Math.max(0.2, w / 150)
    };
  }, [storm]);

  const viewBoxString = useMemo(() => {
    const currentW = baseView.w / viewState.zoom;
    const currentH = baseView.h / viewState.zoom;
    
    const currentX = baseView.x + viewState.panX + (baseView.w - currentW) / 2;
    const currentY = baseView.y + viewState.panY + (baseView.h - currentH) / 2;

    return `${currentX} ${currentY} ${currentW} ${currentH}`;
  }, [baseView, viewState]);

  // --- EVENT HANDLERS ---
  const handleZoomIn = () => setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.5, 50) }));
  const handleZoomOut = () => setViewState(prev => ({ ...prev, zoom: Math.max(prev.zoom / 1.5, 0.1) }));
  const handleReset = () => setViewState({ zoom: 1, panX: 0, panY: 0 });
  const handleWorldView = () => setViewState({ zoom: 0.2, panX: 0, panY: 0 });

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
      const currentWidthDegrees = baseView.w / viewState.zoom;
      const degreesPerPixel = currentWidthDegrees / width;

      setViewState(prev => ({
        ...prev,
        panX: prev.panX - dx * degreesPerPixel,
        panY: prev.panY - dy * degreesPerPixel
      }));
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const toggleLayer = (key: keyof typeof layers) => {
     setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // --- GEOMETRY HELPERS ---
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

  // Convert Nautical Miles to Degrees (Approximate)
  // 1 degree lat ~= 60 nm
  // 1 degree lon ~= 60 nm * cos(lat)
  const nmToDegLat = (nm: number) => nm / 60;
  const nmToDegLon = (nm: number, lat: number) => nm / (60 * Math.cos(lat * Math.PI / 180));

  // Generate Quadrant Path for Wind Radii
  // Start North (up, -Y), go Clockwise
  const getQuadrantPath = (cx: number, cy: number, lat: number, ne: number, se: number, sw: number, nw: number) => {
     if (ne === 0 && se === 0 && sw === 0 && nw === 0) return '';
     
     // Elliptical Arcs for nicer look
     const rNE_x = nmToDegLon(ne, lat); const rNE_y = nmToDegLat(ne);
     const rSE_x = nmToDegLon(se, lat); const rSE_y = nmToDegLat(se);
     const rSW_x = nmToDegLon(sw, lat); const rSW_y = nmToDegLat(sw);
     const rNW_x = nmToDegLon(nw, lat); const rNW_y = nmToDegLat(nw);

     return `
       M ${cx} ${cy - rNW_y}
       A ${rNE_x} ${rNE_y} 0 0 1 ${cx + rNE_x} ${cy}
       A ${rSE_x} ${rSE_y} 0 0 1 ${cx} ${cy + rSE_y}
       A ${rSW_x} ${rSW_y} 0 0 1 ${cx - rSW_x} ${cy}
       A ${rNW_x} ${rNW_y} 0 0 1 ${cx} ${cy - rNW_y}
       Z
     `;
  };

  const visiblePointRadius = baseView.pointRadius / Math.sqrt(Math.max(0.5, viewState.zoom));

  return (
    <div className="w-full h-[500px] bg-slate-900/50 rounded-xl border border-slate-700 shadow-lg backdrop-blur-sm relative overflow-hidden flex flex-col select-none">
      
      {/* Header Overlay */}
      <div className="absolute top-2 left-4 z-10 pointer-events-none">
        <h3 className="text-slate-200 font-bold text-lg drop-shadow-md">{storm.name} Track</h3>
        <p className="text-slate-400 text-xs drop-shadow-md">
           {storm.track.length > 0 ? `${storm.track[0].date} - ${storm.track[storm.track.length-1].date}` : ''}
        </p>
      </div>

      {/* Layers Control */}
      <div className="absolute top-4 right-4 z-30">
         <button 
           onClick={() => setShowLayersMenu(!showLayersMenu)}
           className={`p-2 rounded shadow-lg border transition-colors ${showLayersMenu ? 'bg-cyan-600 border-cyan-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:text-white'}`}
           title="Map Layers"
         >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
         </button>
         
         {showLayersMenu && (
             <div className="absolute top-10 right-0 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 w-48 animate-fade-in space-y-2 z-40">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Layers</div>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                   <input type="checkbox" checked={layers.track} onChange={() => toggleLayer('track')} className="rounded border-slate-600 bg-slate-800 accent-cyan-500" />
                   Storm Track
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                   <input type="checkbox" checked={layers.points} onChange={() => toggleLayer('points')} className="rounded border-slate-600 bg-slate-800 accent-cyan-500" />
                   Intensity Points
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                   <input type="checkbox" checked={layers.windStructure} onChange={() => toggleLayer('windStructure')} className="rounded border-slate-600 bg-slate-800 accent-cyan-500" />
                   Wind Field (Hover)
                </label>
             </div>
         )}
      </div>

      {/* Legend Overlay */}
      <div className="absolute bottom-4 left-4 z-10 bg-slate-900/90 backdrop-blur p-2.5 rounded border border-slate-700 pointer-events-auto hidden sm:block shadow-xl">
         <div className="flex flex-col gap-1.5 text-[10px] text-slate-300 font-medium">
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT5}}></span> Category 5 (&ge;137kt)</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT4}}></span> Category 4</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT3}}></span> Category 3</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT2}}></span> Category 2</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT1}}></span> Category 1</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TS}}></span> Tropical Storm</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TD}}></span> Depression</div>
            {layers.windStructure && (
                <>
                   <div className="h-px bg-slate-700 my-1"></div>
                   <div className="flex items-center"><span className="w-3 h-3 rounded-full mr-2 border border-emerald-500 bg-emerald-500/20"></span> 34kt Radii (TS)</div>
                   <div className="flex items-center"><span className="w-3 h-3 rounded-full mr-2 border border-yellow-500 bg-yellow-500/20"></span> 50kt Radii (Storm)</div>
                   <div className="flex items-center"><span className="w-3 h-3 rounded-full mr-2 border border-rose-500 bg-rose-500/20"></span> 64kt Radii (Hurricane)</div>
                </>
            )}
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
                fill="#1e293b"
                stroke="#334155"
                strokeWidth={visiblePointRadius * 0.5}
                className="transition-colors hover:fill-slate-700"
              />
            ))}
          </g>

          {/* 2. Wind Field Layer (If Toggled & Hovered) */}
          {layers.windStructure && hoveredPoint && hoveredPoint.radii && (
              <g className="wind-field-layer pointer-events-none">
                 {/* 34kt */}
                 <path 
                    d={getQuadrantPath(hoveredPoint.lon, -hoveredPoint.lat, hoveredPoint.lat, hoveredPoint.radii.ne34, hoveredPoint.radii.se34, hoveredPoint.radii.sw34, hoveredPoint.radii.nw34)}
                    fill="rgba(16, 185, 129, 0.2)"
                    stroke="rgba(16, 185, 129, 0.5)"
                    strokeWidth={visiblePointRadius * 0.2}
                 />
                 {/* 50kt */}
                 <path 
                    d={getQuadrantPath(hoveredPoint.lon, -hoveredPoint.lat, hoveredPoint.lat, hoveredPoint.radii.ne50, hoveredPoint.radii.se50, hoveredPoint.radii.sw50, hoveredPoint.radii.nw50)}
                    fill="rgba(234, 179, 8, 0.2)"
                    stroke="rgba(234, 179, 8, 0.5)"
                    strokeWidth={visiblePointRadius * 0.2}
                 />
                 {/* 64kt */}
                 <path 
                    d={getQuadrantPath(hoveredPoint.lon, -hoveredPoint.lat, hoveredPoint.lat, hoveredPoint.radii.ne64, hoveredPoint.radii.se64, hoveredPoint.radii.sw64, hoveredPoint.radii.nw64)}
                    fill="rgba(244, 63, 94, 0.2)"
                    stroke="rgba(244, 63, 94, 0.5)"
                    strokeWidth={visiblePointRadius * 0.2}
                 />
              </g>
          )}

          {/* 3. Storm Track Line */}
          {layers.track && (
            <polyline
                points={storm.track.map(p => `${p.lon},${-p.lat}`).join(" ")}
                fill="none"
                stroke="#64748b"
                strokeWidth={visiblePointRadius * 0.5}
                strokeDasharray={`${visiblePointRadius}, ${visiblePointRadius}`}
                opacity={0.4}
            />
          )}

          {/* 4. Storm Points */}
          {layers.points && storm.track.map((p, i) => {
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

        {/* Floating Tooltip */}
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
              
              {/* Show Structure Info if Toggled On */}
              {hoveredPoint.radii && (hoveredPoint.radii.ne34 > 0 || hoveredPoint.radii.ne50 > 0 || hoveredPoint.radii.ne64 > 0) && (
                  <div className="mt-1 pt-1 border-t border-slate-700 text-[9px] grid grid-cols-2 gap-x-2">
                     <span className="text-emerald-400">NE34: {hoveredPoint.radii.ne34}nm</span>
                     {hoveredPoint.radii.ne50 > 0 && <span className="text-yellow-400">NE50: {hoveredPoint.radii.ne50}nm</span>}
                     {hoveredPoint.radii.ne64 > 0 && <span className="text-rose-400">NE64: {hoveredPoint.radii.ne64}nm</span>}
                     <span className="text-slate-400">RMW: {hoveredPoint.rmw ? hoveredPoint.rmw + 'nm' : 'N/A'}</span>
                  </div>
              )}

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
