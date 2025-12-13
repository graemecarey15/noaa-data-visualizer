import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Storm, StormDataPoint, WindRadii } from '../types';
import { getStormPointColor, INTENSITY_COLORS, getCategoryLabel } from '../constants';

interface StormMapProps {
  storms: Storm[]; // List of all active storms to render
  focusedStormId?: string; // The specific storm selected for detailed inspection
  onStormFocus?: (id: string) => void;
  stormColors?: Record<string, string>; // ID -> Hex Color
}

// Lightweight World Map GeoJSON URL (Reliable source)
const GEOJSON_URL = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const StormMap: React.FC<StormMapProps> = ({ storms, focusedStormId, onStormFocus, stormColors }) => {
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
     windStructure: true, // Defaulting to TRUE
  });
  
  // Legend State
  const [showLegend, setShowLegend] = useState(true);

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
    
    // Auto-hide legend on small screens
    if (window.innerWidth < 640) {
        setShowLegend(false);
    }
  }, []);

  // Identify Focused Storm Object
  const focusedStorm = useMemo(() => storms.find(s => s.id === focusedStormId), [storms, focusedStormId]);

  // Sort storms for render: Focused Last (Top), Background First (Bottom)
  const renderSortedStorms = useMemo(() => {
     return [...storms].sort((a, b) => {
         if (a.id === focusedStormId) return 1;
         if (b.id === focusedStormId) return -1;
         return 0;
     });
  }, [storms, focusedStormId]);

  // --- MAP PROJECTION LOGIC ---
  const baseView = useMemo(() => {
    if (storms.length === 0) return { x: -130, y: -60, w: 100, h: 60, pointRadius: 0.5 };

    // Calculate Bounds for ALL storms
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let hasPoints = false;

    storms.forEach(storm => {
        storm.track.forEach(p => {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
            hasPoints = true;
        });
    });

    if (!hasPoints) return { x: -130, y: -60, w: 100, h: 60, pointRadius: 0.5 };

    const padding = 10; 
    
    // Safety check for single point or tight clusters
    if (maxLat - minLat < 10) {
      const center = (maxLat + minLat) / 2;
      minLat = center - 5;
      maxLat = center + 5;
    }
    if (maxLon - minLon < 10) {
      const center = (maxLon + minLon) / 2;
      minLon = center - 5;
      maxLon = center + 5;
    }

    minLat -= padding;
    maxLat += padding;
    minLon -= padding;
    maxLon += padding;

    const w = maxLon - minLon;
    const h = maxLat - minLat;

    // Adjust point radius based on scale
    return {
      x: minLon,
      y: -maxLat,
      w: w,
      h: h,
      pointRadius: Math.max(0.2, w / 150)
    };
  }, [storms]);

  // --- ZOOM LOGIC HELPER ---
  const fitToStorm = (stormId: string) => {
    const storm = storms.find(s => s.id === stormId);
    if (!storm || storm.track.length === 0) return;

    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    storm.track.forEach(p => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    });

    const latPad = Math.max(5, (maxLat - minLat) * 0.5); 
    const lonPad = Math.max(5, (maxLon - minLon) * 0.5);
    
    const targetW = (maxLon + lonPad) - (minLon - lonPad);
    const targetH = (maxLat + latPad) - (minLat - latPad);
    
    const targetCenterX = (minLon + maxLon) / 2;
    const targetCenterY = -((minLat + maxLat) / 2); 

    const zoomX = baseView.w / targetW;
    const zoomY = baseView.h / targetH;
    const newZoom = Math.min(Math.min(zoomX, zoomY), 30); 

    const baseCenterX = baseView.x + baseView.w / 2;
    const baseCenterY = baseView.y + baseView.h / 2;

    const newPanX = targetCenterX - baseCenterX;
    const newPanY = targetCenterY - baseCenterY;

    setViewState({
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY
    });
  };

  const viewBoxString = useMemo(() => {
    const currentW = baseView.w / viewState.zoom;
    const currentH = baseView.h / viewState.zoom;
    
    return `${baseView.x + viewState.panX + (baseView.w - currentW) / 2} ${baseView.y + viewState.panY + (baseView.h - currentH) / 2} ${currentW} ${currentH}`;
  }, [baseView, viewState]);
  

  // --- EVENT HANDLERS ---
  const handleZoomIn = () => setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.5, 50) }));
  
  const handleZoomOut = () => setViewState(prev => {
     const minZoom = Math.max(0.2, baseView.w / 180); 
     return { ...prev, zoom: Math.max(prev.zoom / 1.5, minZoom) };
  });
  
  const handleReset = () => setViewState({ zoom: 1, panX: 0, panY: 0 });

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

  // Safe Coordinate Conversion with Hard Clamping
  const MAX_RADIUS_DEG = 12; // Hard cap ~720nm
  
  const nmToDegLat = (nm: number) => {
    if (!nm || !isFinite(nm)) return 0;
    return Math.min(Math.abs(nm) / 60, MAX_RADIUS_DEG);
  };
  
  const nmToDegLon = (nm: number, lat: number) => {
    if (!nm || !isFinite(nm)) return 0;
    const safeLat = Math.max(-85, Math.min(85, lat));
    const cosLat = Math.max(0.05, Math.abs(Math.cos(safeLat * Math.PI / 180)));
    const deg = Math.abs(nm) / (60 * cosLat);
    return Math.min(deg, MAX_RADIUS_DEG);
  };

  const getMaxRad = (r: WindRadii | undefined, key: '34' | '50' | '64') => {
      if (!r) return 0;
      return Math.max(
          r[`ne${key}`] || 0,
          r[`se${key}`] || 0,
          r[`sw${key}`] || 0,
          r[`nw${key}`] || 0
      );
  };
  
  const hasRadii = (r: WindRadii | undefined) => {
     if (!r) return false;
     return (
       (r.ne34 > 0 || r.se34 > 0 || r.sw34 > 0 || r.nw34 > 0) ||
       (r.ne50 > 0 || r.se50 > 0 || r.sw50 > 0 || r.nw50 > 0) ||
       (r.ne64 > 0 || r.se64 > 0 || r.sw64 > 0 || r.nw64 > 0)
     );
  };

  const visiblePointRadius = baseView.pointRadius / Math.sqrt(Math.max(0.5, viewState.zoom));

  // ONLY show structure when explicitly hovering a point
  const activeStructurePoint = hoveredPoint;
  
  // Safe center coordinates
  const cx = activeStructurePoint ? activeStructurePoint.lon : 0;
  const cy = activeStructurePoint ? -activeStructurePoint.lat : 0;
  const isCoordsValid = !isNaN(cx) && !isNaN(cy) && isFinite(cx) && isFinite(cy);

  // Use a unique key for the wind group to force re-render on hover change
  const windGroupKey = activeStructurePoint ? `wind-${activeStructurePoint.datetime}-${activeStructurePoint.lat}-${activeStructurePoint.lon}` : 'wind-none';
  
  // Determine color for wind field
  // If we are hovering a point belonging to a storm, we need that storm's identity color.
  // We don't easily know which storm the hovered point belongs to unless we track it.
  // We can pass the `stormId` in the hover state or just use the focused color if the hovered point is part of focused storm.
  // For simplicity, let's assume active structure point belongs to the focused storm or find the storm it belongs to.
  // Since we only hover points of rendered storms, let's find the storm.
  const activeStructureStormId = useMemo(() => {
      if (!hoveredPoint) return null;
      // Reverse lookup is expensive, but we only have 7 max viewable storms
      for (const s of storms) {
          if (s.track.includes(hoveredPoint)) return s.id;
      }
      return null;
  }, [hoveredPoint, storms]);
  
  const windFieldColor = activeStructureStormId && stormColors ? stormColors[activeStructureStormId] : '#10b981';

  return (
    <div className="w-full h-[500px] bg-slate-900/50 rounded-xl border border-slate-700 shadow-lg backdrop-blur-sm relative overflow-hidden flex flex-col select-none">
      
      {/* Header Overlay */}
      <div className="absolute top-2 left-4 z-10 pointer-events-none">
        <h3 className="text-slate-200 font-bold text-lg drop-shadow-md">
            {focusedStorm ? focusedStorm.name : (storms.length > 0 ? `${storms.length} Storms Active` : 'Global View')}
        </h3>
        <p className="text-slate-400 text-xs drop-shadow-md">
           {focusedStorm && focusedStorm.track.length > 0 ? `${focusedStorm.track[0].date} - ${focusedStorm.track[focusedStorm.track.length-1].date}` : ''}
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

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2 max-w-[200px] pointer-events-none">
         {!showLegend && (
            <button 
                onClick={() => setShowLegend(true)}
                className="pointer-events-auto bg-slate-900/90 backdrop-blur p-2 rounded-lg border border-slate-700 shadow-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                title="Show Map Legend"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
            </button>
         )}
         {showLegend && (
             <div className="pointer-events-auto bg-slate-900/90 backdrop-blur p-3 rounded-lg border border-slate-700 shadow-xl animate-fade-in">
                <div className="flex justify-between items-center mb-2 border-b border-slate-700 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Legend</span>
                    <button 
                       onClick={() => setShowLegend(false)}
                       className="text-slate-500 hover:text-white transition-colors p-0.5 rounded hover:bg-slate-800"
                       title="Hide Legend"
                    >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                         <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                       </svg>
                    </button>
                </div>
                <div className="flex flex-col gap-1.5 text-[10px] text-slate-300 font-medium">
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT5}}></span> Cat 5 (&ge;137kt)</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT4}}></span> Cat 4</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT3}}></span> Cat 3</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT2}}></span> Cat 2</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.CAT1}}></span> Cat 1</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TS}}></span> Tropical Storm</div>
                    <div className="flex items-center"><span className="w-3 h-3 rounded-sm mr-2" style={{background: INTENSITY_COLORS.TD}}></span> Depression</div>
                </div>
             </div>
         )}
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
        <button onClick={handleReset} className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded shadow-lg border border-slate-600 transition-colors" title="Reset View">
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

          {/* 2. Storm Track Lines (Draw All) */}
          {layers.track && renderSortedStorms.map(storm => {
             const isFocused = storm.id === focusedStormId;
             const identityColor = stormColors ? (stormColors[storm.id] || '#94a3b8') : '#94a3b8';
             
             return (
                <g 
                    key={storm.id} 
                    onClick={(e) => {
                        e.stopPropagation();
                        onStormFocus?.(storm.id);
                        fitToStorm(storm.id);
                    }}
                    className="cursor-pointer group"
                >
                    {/* Invisible Hit Area (Wider) for easier clicking */}
                    <polyline
                        points={storm.track.map(p => `${p.lon},${-p.lat}`).join(" ")}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={visiblePointRadius * 2} 
                        className="pointer-events-auto"
                    />
                    {/* Visible Line - Uses Identity Color */}
                    <polyline
                        points={storm.track.map(p => `${p.lon},${-p.lat}`).join(" ")}
                        fill="none"
                        stroke={identityColor} 
                        strokeWidth={isFocused ? visiblePointRadius * 0.5 : visiblePointRadius * 0.3}
                        strokeDasharray={isFocused ? "0" : "2,2"} // Solid if focused, dashed if not
                        opacity={isFocused ? 0.9 : 0.5}
                        className={`transition-all duration-300 ${!isFocused ? 'group-hover:opacity-80' : ''}`}
                    />
                </g>
             );
          })}

          {/* 3. Wind Field Layer (Dynamic: Hovered Only) */}
          {layers.windStructure && activeStructurePoint && isCoordsValid && activeStructurePoint.radii && hasRadii(activeStructurePoint.radii) && (
              <g key={windGroupKey} className="wind-field-layer pointer-events-none opacity-100">
                 {/* Uses Identity Color with Decreasing Opacity for larger radii */}
                 {getMaxRad(activeStructurePoint.radii, '34') > 0 && (
                     <ellipse 
                        cx={cx}
                        cy={cy}
                        rx={nmToDegLon(getMaxRad(activeStructurePoint.radii, '34'), activeStructurePoint.lat)}
                        ry={nmToDegLat(getMaxRad(activeStructurePoint.radii, '34'))}
                        fill={windFieldColor}
                        fillOpacity={0.1}
                        stroke={windFieldColor}
                        strokeOpacity={0.3}
                        strokeWidth={visiblePointRadius * 0.1}
                     />
                 )}
                 {getMaxRad(activeStructurePoint.radii, '50') > 0 && (
                     <ellipse 
                        cx={cx}
                        cy={cy}
                        rx={nmToDegLon(getMaxRad(activeStructurePoint.radii, '50'), activeStructurePoint.lat)}
                        ry={nmToDegLat(getMaxRad(activeStructurePoint.radii, '50'))}
                        fill={windFieldColor}
                        fillOpacity={0.15}
                        stroke={windFieldColor}
                        strokeOpacity={0.4}
                        strokeWidth={visiblePointRadius * 0.1}
                     />
                 )}
                 {getMaxRad(activeStructurePoint.radii, '64') > 0 && (
                     <ellipse 
                        cx={cx}
                        cy={cy}
                        rx={nmToDegLon(getMaxRad(activeStructurePoint.radii, '64'), activeStructurePoint.lat)}
                        ry={nmToDegLat(getMaxRad(activeStructurePoint.radii, '64'))}
                        fill={windFieldColor}
                        fillOpacity={0.25}
                        stroke={windFieldColor}
                        strokeOpacity={0.6}
                        strokeWidth={visiblePointRadius * 0.1}
                     />
                 )}
              </g>
          )}

          {/* 4. Storm Points (Intensity Coded) */}
          {layers.points && renderSortedStorms.map(storm => {
             const isFocused = storm.id === focusedStormId;
             
             if (!isFocused) {
                 return (
                    <g 
                        key={storm.id} 
                        onClick={(e) => {
                            e.stopPropagation();
                            onStormFocus?.(storm.id);
                            fitToStorm(storm.id);
                        }}
                        className="cursor-pointer"
                    >
                         {storm.track.map((p, i) => (
                            <circle 
                                key={`${storm.id}-${i}`}
                                cx={p.lon}
                                cy={-p.lat}
                                r={visiblePointRadius * 0.3} // Smaller background points
                                fill={getStormPointColor(p.maxWind, p.status)}
                                opacity={0.5}
                                className="hover:opacity-100 transition-opacity"
                            />
                         ))}
                    </g>
                 );
             }

             // Focused storm points get detailed interaction (Tooltip hover, etc)
             return storm.track.map((p, i) => {
                const pointColor = getStormPointColor(p.maxWind, p.status);
                const isHovered = activeStructurePoint === p;
                
                return (
                  <circle
                    key={`${storm.id}-${i}`}
                    cx={p.lon}
                    cy={-p.lat}
                    r={p.recordIdentifier === 'L' ? visiblePointRadius * 1.2 : visiblePointRadius * 0.8}
                    fill={pointColor}
                    stroke={isHovered ? '#fff' : (p.recordIdentifier === 'L' ? '#10b981' : 'transparent')}
                    strokeWidth={isHovered ? visiblePointRadius * 0.3 : visiblePointRadius * 0.2}
                    strokeOpacity={isHovered ? 0.8 : 1}
                    className="hover:opacity-100 cursor-pointer hover:stroke-white/50"
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={(e) => {
                        e.stopPropagation();
                        fitToStorm(storm.id);
                    }}
                  />
                );
             });
          })}

          {/* 5. Highlighted Point Ring (Hover) */}
          {hoveredPoint && !isNaN(hoveredPoint.lon) && !isNaN(hoveredPoint.lat) && (
             <g key={`highlight-${hoveredPoint.datetime}`}>
                <circle 
                    cx={hoveredPoint.lon}
                    cy={-hoveredPoint.lat}
                    r={visiblePointRadius * 1.5}
                    fill="none"
                    stroke="white"
                    strokeWidth={visiblePointRadius * 0.2}
                    className="pointer-events-none"
                    opacity={0.5}
                />
                <circle 
                    cx={hoveredPoint.lon}
                    cy={-hoveredPoint.lat}
                    r={visiblePointRadius * 1.8}
                    fill="none"
                    stroke="white"
                    strokeWidth={visiblePointRadius * 0.15}
                    opacity="0.8"
                    className="pointer-events-none"
                >
                    <animate 
                       attributeName="r" 
                       values={`${visiblePointRadius * 1.5};${visiblePointRadius * 2.2};${visiblePointRadius * 1.5}`} 
                       dur="2s" 
                       repeatCount="indefinite" 
                    />
                    <animate 
                       attributeName="opacity" 
                       values="0.8;0.1;0.8" 
                       dur="2s" 
                       repeatCount="indefinite" 
                    />
                </circle>
             </g>
          )}
        </svg>

        {/* Floating Tooltip (Only for Hovered Point) */}
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
              
              {/* Detailed Structure Grid */}
              {hasRadii(hoveredPoint.radii) && layers.windStructure ? (
                   <div className="mt-2 pt-2 border-t border-slate-700">
                      <div className="grid grid-cols-5 gap-x-3 gap-y-1 text-[9px] font-mono text-right">
                         <div className="text-left font-bold text-slate-500">KTS</div>
                         <div className="text-slate-500 text-center">NE</div>
                         <div className="text-slate-500 text-center">SE</div>
                         <div className="text-slate-500 text-center">SW</div>
                         <div className="text-slate-500 text-center">NW</div>

                         {getMaxRad(hoveredPoint.radii, '34') > 0 && (
                            <>
                               <div className="text-left text-emerald-400 font-bold">34</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.ne34}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.se34}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.sw34}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.nw34}</div>
                            </>
                         )}
                         {getMaxRad(hoveredPoint.radii, '50') > 0 && (
                            <>
                               <div className="text-left text-yellow-400 font-bold">50</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.ne50}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.se50}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.sw50}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.nw50}</div>
                            </>
                         )}
                         {getMaxRad(hoveredPoint.radii, '64') > 0 && (
                            <>
                               <div className="text-left text-rose-400 font-bold">64</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.ne64}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.se64}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.sw64}</div>
                               <div className="text-slate-300">{hoveredPoint.radii?.nw64}</div>
                            </>
                         )}
                      </div>
                      <div className="text-slate-500 text-[9px] mt-1 text-center">Radii in Nautical Miles (nm)</div>
                   </div>
              ) : hasRadii(hoveredPoint.radii) && (
                  <div className="mt-1 pt-1 border-t border-slate-700 text-[9px] grid grid-cols-2 gap-x-2">
                     <span className="text-emerald-400">Max 34kt: {getMaxRad(hoveredPoint.radii, '34')}nm</span>
                     {getMaxRad(hoveredPoint.radii, '50') > 0 && <span className="text-yellow-400">Max 50kt: {getMaxRad(hoveredPoint.radii, '50')}nm</span>}
                     {getMaxRad(hoveredPoint.radii, '64') > 0 && <span className="text-rose-400">Max 64kt: {getMaxRad(hoveredPoint.radii, '64')}nm</span>}
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