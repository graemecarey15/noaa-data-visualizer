
import { Storm, StormDataPoint } from '../types';

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
    // However, older formats or HURDAT might use decimals.
    // Heuristic: If it has no dot, assume tenths.
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
const parseAtcf = (lines: string[]): Storm[] => {
  // First, group lines by Basin + Cyclone Number (e.g. "AL09")
  // This is critical for storms that cross years (e.g. Dec 31 -> Jan 1)
  // We want to keep them as ONE storm ID based on the start year.
  
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
      // Determine the Season Year from the first valid line
      // This ID will persist for the whole group
      let seasonYear = 0;
      const track: StormDataPoint[] = [];
      let stormName = 'UNNAMED';
      
      // Temporary loop to find year/name
      for (const line of groupLines) {
         const parts = line.split(',').map(p => p.trim());
         if (parts.length < 8) continue;
         
         const col2 = parts[2];
         const isStandardAtcf = col2 && col2.length === 10;
         
         let yearRaw = '';
         if (isStandardAtcf) {
             yearRaw = col2.substring(0, 4);
             
             // Check name in col 27 (Standard)
             if (parts[27] && isNaN(parseInt(parts[27])) && !isGenericName(parts[27])) {
                 stormName = parts[27];
             }
         } else {
             yearRaw = parts[2]; // Custom format
             
             // Check name in col 23 (Custom)
             if (parts[23] && isNaN(parseInt(parts[23])) && !isGenericName(parts[23])) {
                 stormName = parts[23];
             }
         }
         
         if (seasonYear === 0 && yearRaw) {
             seasonYear = parseInt(yearRaw, 10);
         }
      }
      
      if (seasonYear === 0) return; // Should not happen
      
      const stormId = `${groupKey}${seasonYear}`;
      if (stormName === 'UNNAMED') stormName = `STORM ${groupKey.substring(2)}`;

      // Parse points
      for (const line of groupLines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 8) continue;

        const col2 = parts[2];
        const isStandardAtcf = col2 && col2.length === 10;
        
        let rawDate, latStr, lonStr, windStr, pressureStr, status, recordIdentifier;

        if (isStandardAtcf) {
            // Standard ATCF Format (NHC FTP)
            // 0: Basin, 1: Cy, 2: YYYYMMDDHH, 3: Min/Filler, 4: Tech(BEST), 5: Tau, 6: Lat, 7: Lon, 8: Wind, 9: Pres, 10: Type
            rawDate = col2; 
            latStr = parts[6];
            lonStr = parts[7];
            windStr = parts[8];
            pressureStr = parts[9];
            status = parts[10]; // Usually col 10 for Type (TD, TS, etc)
            recordIdentifier = ''; 
        } else {
            // Custom Preloaded Format (constants.ts)
            // 0: Basin, 1: Cy, 2: Year, 3: Tech, 4: Tau, 5: YYYYMMDDHH, 6: RecID, 7: Status, 8: Lat, 9: Lon, 10: Wind, 11: Pres
            rawDate = parts[5];
            latStr = parts[8];
            lonStr = parts[9];
            windStr = parts[10];
            pressureStr = parts[11];
            status = parts[7];
            recordIdentifier = parts[6];
        }
        
        if (!rawDate || rawDate.length < 10) continue;

        const dateStr = rawDate.substring(0, 8);
        const timeStr = rawDate.substring(8, 10) + '00';
        const { iso, formatted } = parseDate(dateStr, timeStr);

        // Filter out bad coordinates
        if (!latStr || !lonStr) continue;

        const point: StormDataPoint = {
          date: formatted,
          time: timeStr,
          datetime: iso,
          recordIdentifier: recordIdentifier || '',
          status: status || '',
          lat: parseCoordinate(latStr),
          lon: parseCoordinate(lonStr),
          maxWind: parseInt(windStr, 10) || 0,
          minPressure: parseInt(pressureStr, 10) === -999 ? 0 : (parseInt(pressureStr, 10) || 0),
          originalLat: latStr,
          originalLon: lonStr,
        };
        track.push(point);
      }
      
      if (track.length > 0) {
          track.sort((a, b) => a.datetime.localeCompare(b.datetime));
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
const parseStandardHurdat = (lines: string[]): Storm[] => {
  const stormMap = new Map<string, Storm>();
  let currentStormId: string | null = null;

  for (const line of lines) {
    const parts = line.split(',').map(p => p ? p.trim() : '');
    if (parts.length === 0) continue;

    // Header Check: AL092011, IRENE, 15
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

    // Data Row
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

  // Detect Format
  // ATCF usually starts with "AL, 01, 2020" or similar.
  // Relaxed regex: 2 letters, comma, 1-2 digits, comma/date
  const firstLine = lines[0];
  const isAtcf = /^[A-Za-z]{2}\s*,\s*\d{1,2}\s*,/.test(firstLine);

  if (isAtcf) {
    return parseAtcf(lines);
  } else {
    return parseStandardHurdat(lines);
  }
};
