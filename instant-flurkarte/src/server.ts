import { McpServer, image, text } from "skybridge/server";
import { z } from "zod";
import { getBerlinMapAsBase64, getFlurkarteAsBase64, searchAddresses, getPropertyValueData } from "./berlinMapService.js";

// Session-based address history
const addressHistory: string[] = [];
const MAX_HISTORY_SIZE = 10;

const server = new McpServer(
  {
    name: "skybridge-blank",
    version: "0.0.1",
  },
  { capabilities: {} },
);

// Register tools with `server.registerTool(...)`.
// Docs: https://docs.skybridge.tech/api-reference/register-tool

server.registerTool(
  {
    name: "search_addresses",
    description: "Search for addresses based on a query. Returns a list of matching addresses for the user to select from.",
    inputSchema: {
      query: z.string(),
    },
    view: {
      component: "search-addresses",
      description: "Address selection carousel widget"
    },
  },
  async ({ query }) => {
    const addresses = await searchAddresses(query);
    
    return {
      content: [
        text(`Found ${addresses.length} address(es). Please select one:`),
        text(addresses.map((addr: any, idx: number) => 
          `${idx + 1}. ${addr.display_name}`
        ).join('\n'))
      ],
      structuredContent: {
        addresses: addresses
      }
    };
  }
);

server.registerTool(
  {
    name: "get_address_history",
    description: "Get the history of recently searched addresses",
    inputSchema: {},
  },
  async () => {
    if (addressHistory.length === 0) {
      return {
        content: [
          text(`📋 Address History`),
          text(`No addresses have been searched yet.`)
        ]
      };
    }
    
    const historyList = addressHistory.map((addr, idx) => 
      `${idx + 1}. ${addr}`
    ).join('\n');
    
    return {
      content: [
        text(`📋 Address History (Last ${addressHistory.length} addresses)`),
        text(historyList),
        text(`\n💡 Tip: You can select any address from this history to view its map again.`)
      ]
    };
  }
);

server.registerTool(
  {
    name: "get_berlin_map",
    description: "Get the Berlin Bodenrichtwert (property value) map for a specific address",
    inputSchema: {
      address: z.string(),
      zoomLevel: z.number().optional().describe("Zoom level (1-10, where 1 is closest, 10 is furthest). Default: 5"),
      layer: z.string().optional().describe("Layer name: 'brw2026' (2026 property values) or 'brw2025' (2025 property values). Default: 'brw2026'"),
    },
  },
  async ({ address, zoomLevel = 5, layer = 'brw2026' }) => {
    // Add address to history
    if (!addressHistory.includes(address)) {
      addressHistory.unshift(address);
      if (addressHistory.length > MAX_HISTORY_SIZE) {
        addressHistory.pop();
      }
    }
    
    const dataUrl = await getBerlinMapAsBase64(address, zoomLevel, layer);
    
    const layerNames: { [key: string]: string } = {
      'brw2026': '2026 Property Values',
      'brw2025': '2025 Property Values'
    };
    
    return {
      content: [
        text(`✅ Berlin Bodenrichtwert (Property Value) Map`),
        text(`📍 Address: ${address}`),
        text(`🔍 Zoom Level: ${zoomLevel} (1=closest, 10=furthest)`),
        text(`📊 Layer: ${layerNames[layer] || layer}`),
        text(`💾 You can right-click on the image above and select "Save image as..." to download it.`),
        image(Buffer.from(dataUrl.split(',')[1], 'base64'), 'image/png')
      ]
    };
  }
);

server.registerTool(
  {
    name: "get_flurkarte_map",
    description: "Get the Berlin Flurkarte (cadastral) map for a specific address",
    inputSchema: {
      address: z.string(),
      zoomLevel: z.number().optional().describe("Zoom level (1-10, where 1 is closest, 10 is furthest). Default: 5"),
    },
    view: {
      component: "flurkarte-map",
      description: "Flurkarte map display with download button"
    },
  },
  async ({ address, zoomLevel = 1 }) => {
    // Add address to history
    if (!addressHistory.includes(address)) {
      addressHistory.unshift(address);
      if (addressHistory.length > MAX_HISTORY_SIZE) {
        addressHistory.pop();
      }
    }
    
    const dataUrl = await getFlurkarteAsBase64(address, zoomLevel);
    
    return {
      content: [
        text(`✅ Berlin Flurkarte (Cadastral) Map`),
        text(`📍 Address: ${address}`),
        text(`🔍 Zoom Level: ${zoomLevel} (1=closest, 10=furthest)`),
        text(`💾 You can right-click on the image above and select "Save image as..." to download it.`),
        image(Buffer.from(dataUrl.split(',')[1], 'base64'), 'image/png')
      ],
      structuredContent: {
        imageData: dataUrl,
        address: address,
        zoomLevel: zoomLevel
      }
    };
  }
);

server.registerTool(
  {
    name: "get_property_value_data",
    description: "Get detailed property value (Bodenrichtwert) data for a specific address",
    inputSchema: {
      address: z.string(),
      layer: z.string().optional().describe("Layer name: 'brw2026' (2026 property values) or 'brw2025' (2025 property values). Default: 'brw2026'"),
    },
  },
  async ({ address, layer = 'brw2026' }) => {
    const propertyData = await getPropertyValueData(address, layer);
    
    return {
      content: [
        text(`📊 Property Value Data`),
        text(propertyData)
      ]
    };
  }
);

if (process.env.NODE_ENV === "production") {
  const { default: manifest } = await import("./vite-manifest.js");
  server.setViteManifest(manifest);
}

export default await server.run();

export type AppType = typeof server;
