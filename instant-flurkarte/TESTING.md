# Testing Guide - Berlin Flurkarte App

## Overview
This guide covers how to test the Berlin Flurkarte (property value map) application built with Skybridge.

## Prerequisites
- Node.js 24.14.1 or higher
- npm installed
- Project dependencies installed (`npm install`)

## Starting the Development Server

### Local Development
```bash
npm run dev
```

This starts:
- MCP server at `http://localhost:3000/mcp`
- DevTools UI at `http://localhost:3000/`

### With Public URL (for testing with ChatGPT)
```bash
npm run dev --tunnel
```

This provides a public URL that can be used with ChatGPT or other MCP clients.

## Testing with DevTools

### 1. Open DevTools
Navigate to `http://localhost:3000/` in your browser.

### 2. Test Address Search

**Tool:** `search_addresses`

**Input:**
```json
{
  "query": "Wollankstraße 82"
}
```

**Expected Output:**
- Text response showing found addresses
- List of matching addresses with numbers
- Example:
  ```
  Found 3 address(es). Please select one:
  1. Wollankstraße 82, 13359 Berlin, Germany
  2. Wollankstraße 82, 10115 Berlin, Germany
  3. Wollankstraße, 13359 Berlin, Germany
  ```

### 3. Test Map Display

**Tool:** `get_berlin_map`

**Input:**
```json
{
  "address": "Wollankstraße 82, 13359 Berlin, Germany"
}
```

**Expected Output:**
- Berlin Bodenrichtwert (property value) map image
- Base64 encoded PNG image displayed in the response

## Testing with ChatGPT

### Setup
1. Run `npm run dev --tunnel` to get a public URL
2. Copy the MCP URL provided (e.g., `https://xxx.skybridge.tech/mcp`)
3. Add the MCP server to your ChatGPT settings

### Test Conversation Flow

**User:** "I want to see the flurkarte for wollankstraß 82"

**Expected Chatbot Response:**
- Calls `search_addresses` tool
- Shows list of matching addresses
- Asks user to select one

**User:** "Select the first one" or "1"

**Expected Chatbot Response:**
- Calls `get_berlin_map` tool with selected address
- Displays the Berlin property value map

## Test Cases

### Test Case 1: Partial Address Search
**Input:** "Wollankstraße 82"
**Expected:** Multiple address options returned
**Purpose:** Test address disambiguation

### Test Case 2: Complete Address Search
**Input:** "Wollankstraße 82, 13359 Berlin"
**Expected:** Specific address returned (may still show multiple options)
**Purpose:** Test with complete address

### Test Case 3: Invalid Address
**Input:** "Nonexistent Street 999"
**Expected:** Error message "No addresses found"
**Purpose:** Test error handling

### Test Case 4: Map Display
**Input:** Valid complete address
**Expected:** Berlin Bodenrichtwert map image displayed
**Purpose:** Test WMS integration and image rendering

### Test Case 5: German Characters
**Input:** "Müllerstraße 15"
**Expected:** Proper handling of umlauts and special characters
**Purpose:** Test international character support

## Troubleshooting

### Server Won't Start
**Issue:** Port 3000 already in use
**Solution:** Kill process using port 3000 or use a different port

### Address Search Returns No Results
**Issue:** Nominatim API rate limiting or network issues
**Solution:** 
- Wait a few minutes and retry
- Check internet connection
- Verify User-Agent header is set correctly

### Map Image Not Displaying
**Issue:** WMS server error or coordinate conversion failure
**Solution:**
- Check console logs for error messages
- Verify WMS URL is correct: `https://gdi.berlin.de/wms/brw2026`
- Ensure EPSG:25833 coordinate conversion is working

### TypeScript Errors
**Issue:** Type mismatches in code
**Solution:**
- Run `npm run build` to check for compilation errors
- Ensure all imports use `.js` extensions for ES modules
- Check Zod schema definitions match handler parameters

### DevTools Not Loading
**Issue:** Vite HMR (Hot Module Replacement) issue
**Solution:**
- Refresh the browser
- Restart the dev server
- Clear browser cache

## API Endpoints

### Nominatim Geocoding API
- **URL:** `https://nominatim.openstreetmap.org/search`
- **Purpose:** Convert address text to coordinates
- **Rate Limit:** 1 request per second
- **Required:** User-Agent header

### Berlin WMS Server
- **URL:** `https://gdi.berlin.de/wms/brw2026`
- **Purpose:** Retrieve Bodenrichtwert (property value) maps
- **Format:** WMS 1.3.0
- **Coordinate System:** EPSG:25833

## Current Implementation Status

### ✅ Completed
- [x] Address search functionality (`search_addresses` tool)
- [x] Berlin map retrieval (`get_berlin_map` tool)
- [x] Base64 image encoding
- [x] Coordinate system conversion (WGS84 → EPSG:25833)
- [x] Basic text-based address selection

### 🚧 In Progress
- [ ] Address selection UI widget
- [ ] English conversation language setting
- [ ] Enhanced error handling

### 📋 Planned
- [ ] Address history/favorites
- [ ] Map zoom controls
- [ ] Multiple map layers
- [ ] Property value data display

## Development Notes

### File Structure
```
instant-flurkarte/
├── src/
│   ├── server.ts              # MCP server and tool registration
│   ├── berlinMapService.ts     # Address search and map retrieval logic
│   └── views/                  # React widgets (when implemented)
└── TESTING.md                 # This file
```

### Key Functions

**berlinMapService.ts**
- `searchAddresses(query, limit)`: Search for addresses
- `getBerlinMapAsBase64(address)`: Get map as base64 data URL
- `getBboxFromAddress(address, radius)`: Convert address to bounding box

### Tool Schemas

**search_addresses**
```typescript
{
  query: z.string()  // Address search query
}
```

**get_berlin_map**
```typescript
{
  address: z.string()  // Complete Berlin address
}
```

## Support

For issues or questions:
- Check Skybridge documentation: https://docs.skybridge.tech
- Join Discord: https://discord.alpic.ai
- Review capitals example: https://github.com/alpic-ai/skybridge/tree/main/examples/capitals
