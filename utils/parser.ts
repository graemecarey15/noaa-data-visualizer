
import { Storm, StormDataPoint, WindRadii } from '../types';

const parseCoordinate = (coord: string): number => {
  if (!coord) return 0;
  const clean = coord.trim();
  if (!clean) return 0;
  
  const lastChar = clean.slice(-1).toUpperCase();
  const isDirection = ['N', 'S', 'E', 'W'].includes(lastChar);
  
  let value: number;
  let direction = '';

  if (isDirection) {
    const numPart = clean.slice(0, -1);
    value = parseFloat(numPart);
    
    // ATCF Standard often uses "221N" for 22.1N (implied tenths)
    // If there is NO decimal point, and it's 3+ digits, likely tenths.
    if (!numPart.includes('.')) {
        value = value / 10;
    }
    
    direction = lastChar;
  } else {
    value = parseFloat(clean);
  }

  if (isNaN(value)) return 0;

  if (direction === 'S' || direction === 'W') {
    return -value;
  }
  return value;
};

const parseDate = (dateStr: string, timeStr: string): { iso: string, formatted: string } => {
  if (!dateStr || dateStr.length < 8) return { iso: '', formatted: dateStr };
  
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  
  // Handle HHMM
  let h = '00';
  let min = '00';
  
  if (timeStr && timeStr.length >= 4) {
    h = timeStr.substring(0, 2);
    min = timeStr.substring(2, 4);
  }
  
  return {
    iso: `${y}-${m}-${d}T${h}:${min}:00.000Z`,
    formatted: `${y}-${m}-${d}`
  };
};

const isGenericName = (name: string): boolean => {
  const n = name.toUpperCase().trim();
  return (
    !n ||
    n === 'UNNAMED' ||
    n.startsWith('INVEST') ||
    n.startsWith('GENESIS') ||
    n.startsWith('SUBTROP') ||
    n === 'TC' ||
    n === 'TWO' ||
    n === 'LOW' ||
    n === 'BEST' || 
    n === 'NONAME' ||
    // Filter numeric placeholders (One, Two... Twenty)
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
     'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
     'EIGHTEEN', 'NINETEEN', 'TWENTY'].includes(n) ||
    n.match(/^storm\s*\d+$/i) !== null
  );
};

// ATCF (B-Deck) Parser Logic
// This now strictly handles the raw NHC format found in FTP b-decks
const parseAtcf = (lines: string[]): Storm[] => {
  const rawGroups = new Map<string, string[]>();
  
  for (const line of lines) {
     const parts = line.split(',').map(p => p.trim());
     if (parts.length < 2) continue;
     
     const basin = parts[0].toUpperCase();
     const cy = parseInt(parts[1], 10);
     if (!basin || isNaN(cy)) continue;
     
     const key = `${basin}${cy.toString().padStart(2, '0')}`;
     if (!rawGroups.has(key)) rawGroups.set(key, []);
     rawGroups.get(key)!.push(line);
  }

  const storms: Storm[] = [];

  rawGroups.forEach((groupLines, groupKey) => {
      let seasonYear = 0;
      
      // We use a map to handle duplicates lines for the same time (e.g. diff radii)
      const pointMap = new Map<string, StormDataPoint>();
      let stormName = 'UNNAMED';
      
      // Pass 1: Determine Year and Name
      for (const line of groupLines) {
         const parts = line.split(',').map(p => p.trim());
         if (parts.length < 8) continue;
         
         const col2 = parts[2];
         
         // Standard ATCF: Column 2 is Date (YYYYMMDDHH)
         if (col2 && col2.length === 10) {
             const yearRaw = col2.substring(0, 4);
             if (seasonYear === 0 && yearRaw) seasonYear = parseInt(yearRaw, 10);
             
             // Check Name columns
             if (parts[27] && isNaN(parseInt(parts[27])) && !isGenericName(parts[27])) {
                 stormName = parts[27];
             } else if (parts[23] && !isGenericName(parts[23])) {
                 stormName = parts[23]; // Fallback
             }
         }
      }
      
      if (seasonYear === 0) return;
      
      // Pass 2: Parse Data
      for (const line of groupLines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 8) continue;

        // Standard ATCF Format Expected
        // 0:Basin, 1:CY, 2:Date, 3:Tech, 4:Tau, 5:Lat, 6:Lon, 7:Wind, 8:Pres, 9:Status, 10:RadCode...
        
        const rawDate = parts[2]; 
        if (!rawDate || rawDate.length !== 10) continue;

        const latStr = parts[6];
        const lonStr = parts[7];
        const windStr = parts[8];
        const pressureStr = parts[9];
        const status = parts[10];

        // ATCF Structural Data
        let windCode = 0;
        let ne = 0, se = 0, sw = 0, nw = 0;
        let rmwVal = 0;
        
        // Helper to safely parse int or return 0
        const safeInt = (val: string) => parseInt(val, 10) || 0;
        
        if (parts[11]) windCode = safeInt(parts[11]);
        if (parts[13]) ne = safeInt(parts[13]);
        if (parts[14]) se = safeInt(parts[14]);
        if (parts[15]) sw = safeInt(parts[15]);
        if (parts[16]) nw = safeInt(parts[16]);
        if (parts[19]) rmwVal = safeInt(parts[19]);
        
        const dateStr = rawDate.substring(0, 8);
        const timeStr = rawDate.substring(8, 10) + '00';
        const { iso, formatted } = parseDate(dateStr, timeStr);
        const timeKey = iso;

        // Create or Update Point
        let point = pointMap.get(timeKey);
        
        if (!point) {
            if (!latStr || !lonStr) continue;
            point = {
                date: formatted,
                time: timeStr,
                datetime: iso,
                recordIdentifier: '',
                status: status || '',
                lat: parseCoordinate(latStr),
                lon: parseCoordinate(lonStr),
                maxWind: parseInt(windStr, 10) || 0,
                minPressure: parseInt(pressureStr, 10) === -999 ? 0 : (parseInt(pressureStr, 10) || 0),
                originalLat: latStr,
                originalLon: lonStr,
                radii: { ne34:0, se34:0, sw34:0, nw34:0, ne50:0, se50:0, sw50:0, nw50:0, ne64:0, se64:0, sw64:0, nw64:0 }
            };
            pointMap.set(timeKey, point);
        }

        // Merge Structural Data
        if (rmwVal > 0) point.rmw = rmwVal;
        
        // Standard ATCF Multi-row Logic
        if (point.radii) {
            if (windCode === 34) {
                point.radii.ne34 = ne; point.radii.se34 = se; point.radii.sw34 = sw; point.radii.nw34 = nw;
            } else if (windCode === 50) {
                point.radii.ne50 = ne; point.radii.se50 = se; point.radii.sw50 = sw; point.radii.nw50 = nw;
            } else if (windCode === 64) {
                point.radii.ne64 = ne; point.radii.se64 = se; point.radii.sw64 = sw; point.radii.nw64 = nw;
            }
        }
      }
      
      const track = Array.from(pointMap.values());
      
      if (track.length > 0) {
          track.sort((a, b) => a.datetime.localeCompare(b.datetime));
          
          const stormId = `${groupKey}${seasonYear}`;
          if (stormName === 'UNNAMED') stormName = `STORM ${groupKey.substring(2)}`;

          storms.push({
             id: stormId,
             name: stormName,
             year: seasonYear,
             dataCount: track.length,
             track: track
          });
      }
  });

  return storms;
};


// Standard HURDAT2 Parser
// Handles both historical archives and our preloaded data constants
const parseStandardHurdat = (lines: string[]): Storm[] => {
  const stormMap = new Map<string, Storm>();
  let currentStormId: string | null = null;

  for (const line of lines) {
    const parts = line.split(',').map(p => p ? p.trim() : '');
    if (parts.length === 0) continue;

    // Header Detection (e.g., AL092011)
    const isHeader = parts[0].length === 8 && /^[A-Z]{2}\d{6}/.test(parts[0]) && parts.length < 10;

    if (isHeader) {
      const stormId = parts[0];
      currentStormId = stormId;

      if (!stormMap.has(stormId)) {
        const stormName = parts[1] || 'UNNAMED';
        const stormYear = parseInt(stormId.substring(4, 8), 10);
        
        stormMap.set(stormId, {
          id: stormId,
          name: stormName,
          year: stormYear,
          dataCount: 0,
          track: []
        });
      }
      continue;
    }

    if (currentStormId && parts.length >= 4) {
      const storm = stormMap.get(currentStormId)!;

      const dateStr = parts[0];
      const timeStr = parts[1];
      const recordIdentifier = parts[2];
      const status = parts[3];
      const latStr = parts[4];
      const lonStr = parts[5];
      const windStr = parts[6];
      const pressureStr = parts[7];

      if (!dateStr || !latStr || !lonStr) continue;

      let radii: WindRadii | undefined;
      let rmw: number | undefined;

      // Extract Structure Data if available (Cols 8-20)
      if (parts.length >= 20) {
          const p = (idx: number) => parseInt(parts[idx], 10) || 0;
          
          // Check if any radii data exists
          if (p(8) > 0 || p(9) > 0 || p(10) > 0 || p(11) > 0 ||
              p(12) > 0 || p(13) > 0 || p(14) > 0 || p(15) > 0 ||
              p(16) > 0 || p(17) > 0 || p(18) > 0 || p(19) > 0) {
              
              radii = {
                  ne34: p(8), se34: p(9), sw34: p(10), nw34: p(11),
                  ne50: p(12), se50: p(13), sw50: p(14), nw50: p(15),
                  ne64: p(16), se64: p(17), sw64: p(18), nw64: p(19),
              };
          }
          if (parts[20]) {
              const r = parseInt(parts[20], 10);
              if (r > 0) rmw = r;
          }
      }

      const { iso, formatted } = parseDate(dateStr, timeStr);
      
      const point: StormDataPoint = {
        date: formatted,
        time: timeStr,
        datetime: iso,
        recordIdentifier: recordIdentifier,
        status: status,
        lat: parseCoordinate(latStr),
        lon: parseCoordinate(lonStr),
        maxWind: parseInt(windStr, 10) || 0,
        minPressure: parseInt(pressureStr, 10) === -999 ? 0 : (parseInt(pressureStr, 10) || 0),
        originalLat: latStr,
        originalLon: lonStr,
        radii,
        rmw
      };

      storm.track.push(point);
    }
  }

  const result = Array.from(stormMap.values());
  result.forEach(s => {
    s.track.sort((a, b) => a.datetime.localeCompare(b.datetime));
    s.dataCount = s.track.length;
  });

  return result.filter(s => s.track.length > 0);
};

export const parseHurdat2 = (rawData: string): Storm[] => {
  if (!rawData) return [];
  
  const lines = rawData.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  // Detection: HURDAT2 always starts with header like AL092011. ATCF starts with AL, 09...
  const isAtcf = /^[A-Za-z]{2}\s*,\s*\d{1,2}\s*,/.test(firstLine);

  if (isAtcf) {
    return parseAtcf(lines);
  } else {
    return parseStandardHurdat(lines);
  }
};
