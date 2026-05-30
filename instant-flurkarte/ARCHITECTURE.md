# Berlin Real Estate Map Automation System: Technical Specifications

This documentation outlines the end-to-end architecture and sequential workflow of the automated Berlin land registry (`Flurkarte`) and standard land value (`Bodenrichtwert`) fetching engine. The system integrates **Custom GPTs**, **Skybridge (TypeScript Framework)**, and official Berlin Government **WMS Geodata Servers**.

---

## Architecture Overview

The system consists of four decoupled layers designed for maximum scalability, type safety, and multi-AI-agent ecosystem compatibility (e.g., Custom GPTs, Claude Desktop, Cursor, Zed).

1. **Client / Interface Layer (GPT App):** Handles natural language processing (NLP), intent parsing, and final multimodal data visualization.
2. **Infrastructure & Gateway Layer (Skybridge):** Manages serverless hosting, endpoint security (authentication), rate limiting, and observability via the MCP protocol.
3. **Protocol & Core Logic Layer (MCP Server):** Converts OpenAI Action payloads into standardized Model Context Protocol (MCP) tool calls and runs the TypeScript business logic.
4. **Data Layer (External APIs & WMS):** Provides raw geolocation data and official, high-resolution land registry map layers.

---

## Sequential System Workflow

The following sequential diagram illustrates the lifecycle of a single user request, from natural language input to final map rendering:

[User] ➔ "Get me the 2026 Bodenrichtwert map for Wollankstraße 82, Berlin"
│
[GPT App] (Brain: Parses intent and triggers action)
│  (Payload: HTTP POST with address string via OpenAPI Schema)
▼
[Skybridge] (Gateway / Hosting: Infrastructure & Observability Layer)
│  (Validates Auth, checks Rate Limits, and logs real-time API metrics)
▼
[MCP Server] (Hands & Feet: Executes TypeScript Core Logic inside Skybridge Runtime)
├── 1. Nominatim API Call (Converts text address ➔ WGS84 Lat/Lon coordinates)
├── 2. Proj4 Library Computation (Transforms WGS84 ➔ Berlin's official EPSG:25833 UTM metric coordinates)
└── 3. Berlin WMS Server Request (Calculates BBOX bounds and fetches the 2026 official map layer as a PNG stream)
│
[Skybridge] ➔ Encodes raw PNG binary into a Base64 string and packages the JSON response
│
[GPT App] ➔ Decodes the Base64 string into a multimodal image component and summarizes the land value data (1,200 EUR/㎡)
│
[User] ➔ Views the high-resolution official map and real estate valuation report in the chat UI

---

## Component Deep Dive

### 1. Geocoding & Coordinate Transformation (`EPSG:4326` to `EPSG:25833`)
Standard global mapping services rely on WGS84 (Latitude/Longitude). However, the Berlin Spatial Data Infrastructure (**GDI Berlin**) requires coordinates in **ETRS89 / UTM Zone 33N (EPSG:25833)** to render precise, meter-based land parcels. The core TypeScript module utilizes `proj4` locally to perform this mathematical transformation instantly without external overhead.

**Implementation:** `berlinMapService.ts`
- Function: `getBboxFromAddress()`
- Transformation: WGS84 (lat/lon) → EPSG:25833 (UTM meters)
- Library: `proj4` for coordinate system conversion

### 2. Dynamic Bounding Box (`BBOX`) Calculation
Based on the transformed $X, Y$ center point, the system dynamically calculates a local bounding box matching a custom radius (e.g., an offset of $75\text{m}$ for a crisp $150\text{m} \times 150\text{m}$ neighborhood view).
* **Format:** `MIN_X, MIN_Y, MAX_X, MAX_Y`
* **Zoom Levels:** 1-10 (1=closest/25m radius, 10=furthest/750m radius)

**Implementation:** `berlinMapService.ts`
- Function: `getBboxFromAddress(address, radiusInMeters)`
- Default radius: 75m (configurable via zoomLevel parameter)

### 3. Web Map Service (WMS) Integration
Instead of heavy browser automation (headless scraping via Puppeteer), the system makes a direct, lightweight HTTP GET request to the official GDI Berlin server using standard OGC WMS parameters:

**Bodenrichtwert (Property Value) Maps:**
* **URL:** `https://gdi.berlin.de/services/wms/brw2026` (2026) or `https://gdi.berlin.de/services/wms/brw2025` (2025)
* **Parameters:**
  * `REQUEST`: `GetMap`
  * `LAYERS`: `brw2026` or `brw2025` *(Official Standard Land Value Layer)*
  * `CRS`: `EPSG:25833`
  * `FORMAT`: `image/png`
  * `WIDTH/HEIGHT`: `400x300` pixels

**Flurkarte (Cadastral) Maps:**
* **URL:** `https://gdi.berlin.de/services/wms/flurkarte`
* **Parameters:**
  * `REQUEST`: `GetMap`
  * `LAYERS`: `flurkarte` *(Official Cadastral Map Layer)*
  * `CRS`: `EPSG:25833`
  * `FORMAT**: `image/png`

**Implementation:** `berlinMapService.ts`
- Functions: `getBerlinMapAsBase64()`, `getFlurkarteAsBase64()`
- Library: `axios` for HTTP requests with binary response handling

---

## MCP Tools & API Endpoints

The system exposes four main MCP tools via the Skybridge server:

### 1. `search_addresses`
**Purpose:** Search for addresses based on a query string
**Input:** `query` (string)
**Output:** List of matching addresses with display names
**Implementation:** Uses Nominatim API with German country filter

### 2. `get_berlin_map`
**Purpose:** Get Berlin Bodenrichtwert (property value) map for a specific address
**Input:** 
- `address` (string)
- `zoomLevel` (number, optional, 1-10, default: 5)
- `layer` (string, optional, 'brw2026' or 'brw2025', default: 'brw2026')
**Output:** Base64-encoded PNG image with metadata

### 3. `get_flurkarte_map`
**Purpose:** Get Berlin Flurkarte (cadastral) map for a specific address
**Input:**
- `address` (string)
- `zoomLevel` (number, optional, 1-10, default: 8)
**Output:** Base64-encoded PNG image with metadata and download widget

### 4. `get_property_value_data`
**Purpose:** Get detailed property value (Bodenrichtwert) data for a specific address
**Input:**
- `address` (string)
- `layer` (string, optional, 'brw2026' or 'brw2025', default: 'brw2026')
**Output:** Text-formatted property value data

### 5. `get_address_history`
**Purpose:** Get the history of recently searched addresses
**Input:** None
**Output:** List of recently searched addresses (max 10)

---

## File Structure

```
instant-flurkarte/
├── src/
│   ├── server.ts              # MCP server and tool registration
│   ├── berlinMapService.ts    # Address search and map retrieval logic
│   ├── helpers.ts             # Utility functions
│   └── views/                 # React widgets
│       ├── flurkarte-map.tsx  # Flurkarte map display widget
│       └── search-addresses.tsx # Address selection widget
├── ARCHITECTURE.md            # This file
├── TESTING.md                 # Testing guide
├── AGENTS.md                  # Agent configuration
└── package.json               # Dependencies
```

---

## Production Deployment Benefits

* **Zero Infrastructure Overhead:** Using **Skybridge** removes the need for managing Docker containers, AWS EC2 configurations, or setting up SSL/HTTPS certs manually.
* **Production-Grade Observability:** Skybridge provides instant dashboards to track how fast the Berlin WMS server responds, monitor user request rates, and catch potential upstream geocoding errors immediately.
* **Write Once, Run Everywhere:** Because the backend relies on the **Model Context Protocol (MCP)** via **Skybridge**, this exact same server code can be used simultaneously as an OpenAI Custom GPT Action and as an AI developer tool inside IDEs like Cursor or Claude Desktop without modifying a single line of code.
* **Type Safety:** Full TypeScript support with Zod schemas for input validation ensures type safety across the entire stack.

---

## Key Dependencies

* **skybridge/server:** MCP server framework
* **axios:** HTTP client for API requests
* **proj4:** Coordinate system transformation library
* **zod:** Schema validation for tool inputs

---

## Error Handling

The system implements comprehensive error handling for:

* **Nominatim API:** Rate limiting (429), timeouts, network errors, access denied (403)
* **WMS Servers:** Layer not available, invalid coordinate systems, invalid bounding boxes, service errors
* **Network Issues:** Connection timeouts, DNS resolution failures
* **Coordinate Transformation:** Invalid coordinates, transformation failures

All errors are caught and returned with user-friendly error messages in both English and the appropriate context.

---

## Development Workflow

1. **Local Development:** Run `npm run dev` to start the MCP server at `http://localhost:3000/mcp`
2. **Testing:** Use the DevTools UI at `http://localhost:3000/` to test tools interactively
3. **Public Testing:** Run `npm run dev --tunnel` to get a public URL for ChatGPT integration
4. **Deployment:** Deploy to Skybridge for production hosting with automatic HTTPS and observability

---

## Future Enhancements

* **Address Selection UI Widget:** Interactive carousel for address selection (in progress)
* **Map Layer Controls:** Toggle between different map layers
* **Property Value Visualization:** Interactive charts and graphs for property value trends
* **Address History & Favorites:** Persistent storage for frequently searched addresses
* **Multi-city Support:** Extend beyond Berlin to other German cities with WMS services
