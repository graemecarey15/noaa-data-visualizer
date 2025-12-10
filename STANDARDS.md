# Data Standards for Hurdat2 Visualizer

This document defines the quality and formatting standards for storm data used in this application. All preloaded and imported data should adhere to these specifications to ensure accurate visualization and analysis.

## 1. Completeness
All storm records must contain the **entire lifecycle** of the system.
*   **Start**: Must include the initial genesis points (Invest, Tropical Depression, or Potential Tropical Cyclone) if available.
*   **End**: Must include the track until dissipation, absorption, or transition to an extratropical low. **Do not truncate** data at the last landfall.
*   **Gapless**: No missing synoptic times (00Z, 06Z, 12Z, 18Z). Intermediate points are encouraged for landfall precision.

## 2. Mandatory Fields
Every data point must contain valid values for:
*   **Date/Time**: UTC format (YYYYMMDDHH).
*   **Coordinates**: Latitude (N/S) and Longitude (E/W) with at least 0.1 degree precision.
*   **Intensity**: Maximum sustained wind (knots) and Minimum central pressure (mb).
*   **Status**: Classification code (TD, TS, HU, EX, LO, DB).

## 3. Event Flags (Record Identifiers)
The `recordIdentifier` column (often col 3 in HURDAT, col 6 in ATCF) is critical for the Timeline UI.
*   **L (Landfall)**: MUST be present for every coastal crossing.
*   **P (Minimum Pressure)**: Should mark the point of lowest pressure.
*   **I (Peak Intensity)**: Should mark the point of highest wind.

## 4. Format Specifications
The application supports two primary formats. **ATCF B-Deck** is preferred for modern/active data.

### Format A: ATCF Best Track (B-Deck)
Used for 2024-Present data.
`BASIN, CY, YYYY, BEST, RR, YYYYMMDDHH, ..., LAT, LON, WND, PRES, ..., STATUS, ...`
*   **Example**: `AL, 09, 2024, BEST, 10, 2024092600, ...`

### Format B: HURDAT2 Standard
Used for Historical Archive (1851-2023).
*   Header: `AL092011, IRENE, 45`
*   Row: `20110827, 1200, L, HU, 34.4N, 76.5W, 75, 952, ...`

## 5. Naming Convention
*   **Unnamed Systems**: Should be labeled "UNNAMED" or "STORM X" in the UI, not "INVEST" or "GENESIS" unless currently active.
*   **Consolidation**: Splits in raw data (e.g. `AL09` vs `AL092024`) must be consolidated into a single Storm ID in the parser.
