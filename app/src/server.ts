import { McpServer } from "skybridge/server";
import { z } from "zod";
import { nrwAdapter } from "./adapters/nrw.js";
import { berlinAdapter } from "./adapters/berlin.js";
import {
  selectAdapter,
  type FlurkarteInput,
} from "./shared/contract.js";

const flurkarteInputSchema = {
  address: z
    .string()
    .optional()
    .describe(
      "Full German address including house number, e.g. 'Unnaer Straße 1, 59423 Unna'. This alone is sufficient — no cadastral IDs needed.",
    ),
  bundesland: z.string().optional().describe("Bundesland, e.g. NRW."),
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
    name: "alpic-openai-app",
    version: "0.0.1",
  },
  { capabilities: {} },
)
  .registerTool(
    {
      name: "start",
      description: "Onboard Skybridge",
      inputSchema: {
        name: z.string().optional().describe("The user name."),
      },
      annotations: {
        title: "Start Skybridge onboarding",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Starting the Skybridge onboarding…",
        "openai/toolInvocation/invoked": "Onboarding ready.",
      },
      view: {
        component: "onboarding",
        // Replace with the URL your widget will be served from in production.
        domain: "https://skybridge.tech",
        description: "Onboarding deck",
        csp: {
          resourceDomains: [
            "https://fonts.googleapis.com",
            "https://fonts.gstatic.com",
          ],
          redirectDomains: ["https://docs.skybridge.tech"],
        },
      },
    },
    async ({ name }) => {
      return {
        structuredContent: { name },
        content: [{ type: "text", text: `User name: ${name ?? "friend"}` }],
        isError: false,
      };
    },
  )
  .registerTool(
    {
      name: "get-fortune-cookie",
      description: "Get fortune cookie",
      annotations: {
        title: "Get a fortune cookie",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Cracking open a fortune cookie…",
        "openai/toolInvocation/invoked": "Fortune revealed.",
      },
    },
    async () => {
      const predictions = [
        "A pleasant surprise is waiting for you.",
        "Your hard work will soon pay off.",
        "An unexpected friendship will brighten your week.",
        "The best is yet to come.",
        "A small step today leads to a giant leap tomorrow.",
        "Trust your instincts: they are sharper than you think.",
        "Adventure awaits just around the corner.",
        "A long-forgotten idea will return with great success.",
        "Kindness given today will be returned threefold.",
        "Something you lost will soon be found.",
      ];
      const prediction =
        predictions[Math.floor(Math.random() * predictions.length)];

      // simulate backend work
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return {
        structuredContent: { prediction },
        content: [{ type: "text", text: prediction }],
        isError: false,
      };
    },
  )
  .registerTool(
    {
      name: "get_flurkarte",
      description:
        "Generate the official cadastral map (Flurkarte / Liegenschaftskarte) as a PDF for a given German address. Supports NRW (Nordrhein-Westfalen) and Berlin/Brandenburg. IMPORTANT: only the `address` (street + house number + postal code + city) is required — the tool automatically detects the state, geocodes the address and resolves the exact parcel. Do NOT ask the user for Gemarkung, Flur or Flurstueck; those are optional and only used as a fallback when no address is available. As soon as you have an address, call this tool directly.",
      inputSchema: flurkarteInputSchema,
      annotations: {
        title: "Get Flurkarte",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Requesting the Flurkarte...",
        "openai/toolInvocation/invoked": "Flurkarte PDF ready.",
      },
      view: {
        component: "get-flurkarte",
        description: "Official Flurkarte (PDF) — preview & download",
        csp: {
          // WMS preview image (inline) + opening the official PDF in the browser.
          resourceDomains: ["https://www.wms.nrw.de", "https://gdi.berlin.de"],
          redirectDomains: ["https://www.tim-online.nrw.de", "https://gdi.berlin.de"],
        },
      },
    },
    async (input) => {
      const flurkarteInput: FlurkarteInput = input;
      const result = await selectAdapter(
        flurkarteInput,
        [berlinAdapter, nrwAdapter],
      ).getFlurkarte(flurkarteInput);

      // Keep the model-facing payload lean. The base64 PDF (~200 KB+) MUST NOT
      // go into structuredContent: it floods the LLM context and the host
      // rejects the response ("An error occurred"). Binary + URLs live in
      // _meta, which reaches the view only and never the model.
      const { pdfUrl, pdfDownloadUrl, previewImageUrl, ...metadata } = result;

      return {
        structuredContent: metadata,
        content: [
          {
            type: "text",
            text:
              `Generated Flurkarte PDF for ${result.address} (${result.bundesland}) from ${result.source}.` +
              (result.warning ? ` ⚠️ ${result.warning}` : ""),
          },
        ],
        _meta: { pdfUrl, pdfDownloadUrl, previewImageUrl },
        isError: false,
      };
    },
  );

if (process.env.NODE_ENV === "production") {
  const { default: manifest } = await import("./vite-manifest.js");
  server.setViteManifest(manifest);
}

export default await server.run();

export type AppType = typeof server;
