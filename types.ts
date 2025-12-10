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