import { McpServer } from "skybridge/server";
import { z } from "zod";
import { nrwAdapter } from "./adapters/nrw.js";
import {
  selectAdapter,
  type FlurkarteInput,
} from "./shared/contract.js";

const flurkarteInputSchema = {
  address: z
    .string()
    .optional()
    .describe("Address, e.g. Domkloster 4, 50667 Koeln."),
  bundesland: z.string().optional().describe("Bundesland, e.g. NRW."),
  gemarkung: z.string().optional().describe("Gemarkung."),
  flur: z.string().optional().describe("Flur."),
  flurstueck: z.string().optional().describe("Flurstueck."),
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
        "Return an M1 Instant Flurkarte PDF from the official NRW ALKIS WMS for a hardcoded Koeln bbox.",
      inputSchema: flurkarteInputSchema,
      annotations: {
        title: "Get Flurkarte",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Fetching the NRW ALKIS map...",
        "openai/toolInvocation/invoked": "Flurkarte PDF ready.",
      },
    },
    async (input) => {
      const flurkarteInput: FlurkarteInput = input;
      const result = await selectAdapter(
        flurkarteInput,
        [nrwAdapter],
      ).getFlurkarte(flurkarteInput);

      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: `Generated M1 Flurkarte PDF for ${result.address} (${result.bundesland}) from ${result.source}.`,
          },
        ],
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
