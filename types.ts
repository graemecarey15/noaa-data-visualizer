
export interface WindRadii {
  // 34 knot (Tropical Storm Force)
  ne34: number;
  se34: number;
  sw34: number;
  nw34: number;
  
  // 50 knot (Storm Force)
  ne50: number;
  se50: number;
  sw50: number;
  nw50: number;

  // 64 knot (Hurricane Force)
  ne64: number;
  se64: number;
  sw64: number;
  nw64: number;
}

export interface StormDataPoint {
  date: string; // Formatted YYYY-MM-DD
  time: string; // HHMM
  datetime: string; // ISO String for sorting
  recordIdentifier: string; // L = Landfall, P = Peak, etc.
  status: string; // TD, TS, HU, EX, etc.
  lat: number;
  lon: number;
  maxWind: number; // knots
  minPressure: number; // mb
  originalLat: string;
  originalLon: string;
  
  // Structural Data
  radii?: WindRadii;
  rmw?: number; // Radius of Max Winds (nm)
}

export interface Storm {
  id: string; // e.g., AL092011
  name: string; // e.g., IRENE
  year: number;
  dataCount: number;
  track: StormDataPoint[];
}

export enum ParsingState {
  IDLE,
  PARSING,
  SUCCESS,
  ERROR
}