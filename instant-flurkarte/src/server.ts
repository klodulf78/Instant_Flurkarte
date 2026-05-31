import { McpServer, image, text } from "skybridge/server";
import { z } from "zod";
import { berlinAdapter } from "./adapters/berlin.js";
import { selectAdapter, type FlurkarteInput } from "./shared/contract.js";
import { searchAddresses } from "./berlinMapService.js";

// Session-based address history
const addressHistory: string[] = [];
const MAX_HISTORY_SIZE = 10;

const flurkarteInputSchema = {
  address: z
    .string()
    .optional()
    .describe(
      "Full German address including house number, e.g. 'Potsdamer Platz 10, 10785 Berlin'. This alone is sufficient — no cadastral IDs needed.",
    ),
  bundesland: z.string().optional().describe("Bundesland, e.g. Berlin or Brandenburg."),
  gemarkung: z
    .string()
    .optional()
    .describe(
      "Optional fallback. Only used if no address is provided. Do not ask the user for this.",
    ),
  flur: z
    .string()
    .optional()
    .describe(
      "Optional fallback. Only used if no address is provided. Do not ask the user for this.",
    ),
  flurstueck: z
    .string()
    .optional()
    .describe(
      "Optional fallback. Only used if no address is provided. Do not ask the user for this.",
    ),
} satisfies Record<keyof FlurkarteInput, z.ZodOptional<z.ZodString>>;

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
    
    const { getBerlinMapAsBase64 } = await import("./berlinMapService.js");
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
      ],
      _meta: {
        imageData: dataUrl
      },
      structuredContent: {
        address: address,
        bundesland: 'Berlin',
        layer: layer,
        zoomLevel: zoomLevel
      }
    };
  }
);

server.registerTool(
  {
    name: "get_flurkarte",
    description:
      "Generate the official Berlin/Brandenburg cadastral map (Flurkarte / Liegenschaftskarte) for a given German address. IMPORTANT: only the `address` (street + house number + postal code + city in Berlin/Brandenburg) is required — the tool automatically geocodes the address and resolves the exact parcel. Do NOT ask the user for Gemarkung, Flur or Flurstueck; those are optional and only used as a fallback when no address is available. As soon as you have an address, call this tool directly.",
    inputSchema: flurkarteInputSchema,
    annotations: {
      title: "Get Flurkarte",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    _meta: {
      "openai/toolInvocation/invoking": "Requesting the Berlin Flurkarte...",
      "openai/toolInvocation/invoked": "Flurkarte ready.",
    },
    view: {
      component: "flurkarte-map",
      description: "Berlin/Brandenburg Flurkarte — preview & download",
      csp: {
        resourceDomains: ["https://gdi.berlin.de"],
      },
    },
  },
  async (input) => {
    const flurkarteInput: FlurkarteInput = input;
    const result = await selectAdapter(
      flurkarteInput,
      [berlinAdapter],
    ).getFlurkarte(flurkarteInput);

    // Keep the model-facing payload lean. The base64 image (~250 KB+) MUST NOT
    // go into structuredContent: it floods the LLM context and the host
    // rejects the response ("An error occurred"). Binary + URLs live in
    // _meta, which reaches the view only and never the model.
    const { pdfUrl, previewImageUrl, ...metadata } = result;

    return {
      structuredContent: metadata,
      content: [
        {
          type: "text",
          text:
            `Generated Flurkarte for ${result.address} (${result.bundesland}) from ${result.source}.` +
            (result.warning ? ` ⚠️ ${result.warning}` : ""),
        },
      ],
      _meta: { pdfUrl, previewImageUrl },
      isError: false,
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
    const { getPropertyValueData } = await import("./berlinMapService.js");
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
