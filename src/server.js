#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FlurkarteError, get_flurkarte } from "./infolika-thueringen.js";

const server = new McpServer({
  name: "instant-flurkarte",
  version: "0.1.0"
});

const stderrLogger = {
  info: (...args) => console.error(...args),
  warn: (...args) => console.error(...args),
  error: (...args) => console.error(...args)
};

server.tool(
  "get_flurkarte",
  "Return an official cadastral extract PDF URL and parcel metadata. Thüringen address search is implemented via InfoLika.",
  {
    address: z.string().optional(),
    bundesland: z.string().optional(),
    gemarkung: z.string().optional(),
    flur: z.string().optional(),
    flurstueck: z.string().optional()
  },
  async (args) => {
    try {
      const result = await get_flurkarte(args, { logger: stderrLogger });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      const body = error instanceof FlurkarteError
        ? { error: { code: error.code, message: error.message, details: error.details } }
        : { error: { code: "UNKNOWN_ERROR", message: error.message } };

      return {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify(body, null, 2)
        }]
      };
    }
  }
);

await server.connect(new StdioServerTransport());
