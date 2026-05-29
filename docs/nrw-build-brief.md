# NRW Build Brief — Instant Flurkarte (for Codex)

> Read this together with `bank-requirements.md`. You are the **builder**; the
> architecture below is fixed. Keep all NRW logic behind one adapter so Berlin
> and Thüringen can plug into the same contract later.

## What you are building
A Skybridge GPT App exposing one MCP tool, `get_flurkarte`. Given an address
or cadastral IDs in NRW, it returns a **bank-conform PDF** of the official
cadastral map (Liegenschaftskarte) plus metadata.

## Shared contract (DO NOT change the signature)
```ts
get_flurkarte(input: {
  address?: string;          // e.g. "Domkloster 4, 50667 Köln"
  bundesland?: string;       // "NRW" | "Nordrhein-Westfalen"
  gemarkung?: string;
  flur?: string;
  flurstueck?: string;
}): {
  pdfUrl: string;
  flurstueckskennzeichen: string;
  address: string;
  bundesland: "NRW";
  source: string;            // e.g. "Geobasis NRW (ALKIS WMS + OGC API)"
  extractedAt: string;       // ISO 8601
}
```
Rule: either `address` OR (`gemarkung` + `flur` + `flurstueck`) must be given.

## Data sources (NRW) — all free, public, no API key
1. **Parcel resolution — OGC API Features (Liegenschaftskataster NRW)**
   - Base: `https://ogc-api.nrw.de/lika/v1`
   - Collections: `flurstueck`, `gebaeude_bauwerk`, `nutzung`, `katasterbezirk`
   - GeoJSON: append `?f=json&profile=rfc7946` · CRS: **EPSG:25832**
   - **First step:** inspect the schema →
     `GET /collections/flurstueck/items?limit=1&f=json&profile=rfc7946`
     to learn the exact attribute names (Flurstückskennzeichen, Gemarkung,
     Flur, Flurstücksnummer). Do not guess them.
   - Query by attributes when cadastral IDs are given; query by point
     (bbox / intersects) when resolving from an address.
2. **Address → coordinate (geocoding)**
   - Turn an address into an EPSG:25832 point, then spatial-query `flurstueck`.
   - Prefer the BKG / NRW geocoding service; Nominatim is an acceptable
     hackathon fallback.
3. **Official map rendering — ALKIS WMS (Liegenschaftskarte)**
   - `https://www.wms.nrw.de/geobasis/wms_nw_alkis` (variants `_grau`, `_gelb`)
   - License: **Datenlizenz Deutschland Zero** (commercial use OK)
   - `GetMap`, CRS EPSG:25832, PNG, BBOX = parcel extent + margin.
   - This is the official cadastral symbology — same content the portal prints.

## Pipeline
1. Resolve the target parcel → geometry + Flurstückskennzeichen + neighbors
   (parcels intersecting an expanded bbox) + the **Zuwegung** (access to the
   nearest public street).
2. Compute a print bbox around the parcel. **Hard rule:** the bbox must contain
   the **complete parcel** (never cut off) AND its **Zuwegung to a public
   street**. If the parcel sits far from a road, zoom out until the access is in
   frame. Leave a margin so neighboring parcels are visible; then pick a scale
   (~1:500–1:1000).
3. Fetch the ALKIS WMS `GetMap` image for that bbox.
4. Compose a PDF: official map image + **highlight the target parcel** +
   header (address, Flurstückskennzeichen, Gemarkung/Flur/Flurstück,
   Bundesland, scale, north arrow, source, extraction date).
5. Host the PDF (Skybridge static/temp) and return the contract object.

## Milestones (build IN ORDER, verify each before moving on)
- **M1** — `get_flurkarte` returns a PDF with the WMS image for a *hardcoded*
  bbox in Köln. Proves WMS fetch + PDF compose + MCP wiring.
- **M2** — cadastral IDs → resolve geometry via OGC API → dynamic bbox → PDF.
- **M3** — address → geocode → parcel → PDF.
- **M4** — neighbors + nearest street + parcel highlight + full bank header.

## Bank-conformity (acceptance)
Per `bank-requirements.md`, the PDF MUST show: **Zuwegung** (access to a public
street), the **complete parcel** with **Flur + Flurstücksnummer**, **address +
house number**, **all surrounding parcels** with numbers, boundaries, Gemarkung
— plus a header frame with Bundesland, address, scale, north arrow, source,
date. **Non-certified is sufficient.**

## Constraints
- Node 22+, Skybridge framework.
- All NRW specifics behind `nrwAdapter` implementing the shared contract.
- **No scraping of the TIM-online UI.** Use the documented services above.
- Stretch goal only (if everything else works): investigate the TIM-online
  MapFish Print endpoint for a 1:1 official PDF.
