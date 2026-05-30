# Instant Flurkarte & Bodenrichtwert GPT App

## Value Proposition
Fetch and display official Berlin cadastral land registry maps (`Flurkarte`) and standard land values (`Bodenrichtwert`) instantly.
Target users: Real estate investors, developers, surveyors, and property buyers in Berlin.
Pain: Accessing official land registry maps usually requires navigating slow, complicated public geodata portals or manual requests. This app provides direct visual lookup through conversation.

**Core actions**: Search address, view Bodenrichtwert (land value) maps, view Flurkarte (cadastral) maps, download parcel maps in PDF/PNG, and check property values.

## Why LLM?
**Conversational win**: "Get the 2026 land registry map for Wollankstraße 82" parses and executes immediately, instead of navigating complex maps and layers.
**LLM adds**: Address normalization, year/layer intent detection, and summarizing property metadata.
**What LLM lacks**: Real-time official WMS geodata servers, Nominatim coordinate geocoding, UTM projections.

## UI Overview
1. **Search Results**: Interactive carousel displaying address options returned from Nominatim.
2. **Map Views**: Premium card display showing the requested map (Bodenrichtwert or Flurkarte) with zoom options, parcel details, and high-fidelity download links (PNG / PDF).

## Product Context
- **APIs**: Nominatim OSM geocoding, Berlin GDI WMS servers (`https://gdi.berlin.de/services/wms/...`).
- **Dependencies**: `proj4` for EPSG:25833 (UTM metric coordinates) conversion, `jspdf` for PDF export.
- **Constraints**: Berlin geodata only.

## UX Flows

### Get Map and Details for Address
1. User provides address.
2. If multiple addresses match, show **Search Results** carousel to select the exact address.
3. Once selected, show **Map View** showing the WMS map, details, and download controls.

## Tools and Views

### View: `search_addresses`
- **Input**: `{ query }`
- **Output**: `{ addresses[] }`
- **Views**: Carousel card for selecting the precise address.

### View: `get_berlin_map`
- **Input**: `{ address, zoomLevel, layer }`
- **Output**: `{ imageData, address, zoomLevel }`
- **Views**: Map card with details and download options.

### View: `get_flurkarte_map`
- **Input**: `{ address, zoomLevel }`
- **Output**: `{ imageData, address, zoomLevel }`
- **Views**: Map card with details and download options.
