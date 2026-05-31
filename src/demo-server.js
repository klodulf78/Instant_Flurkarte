#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlurkarteError, getFlurkarteDemo } from "./infolika-thueringen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const demoLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/flurkarte") {
      return handleFlurkarte(request, response);
    }

    if (request.method !== "GET") {
      return sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error("[demo] request failed", error);
    return sendJson(response, 500, {
      error: {
        code: "DEMO_SERVER_ERROR",
        message: "The demo server hit an unexpected error."
      }
    });
  }
});

server.on("error", (error) => {
  console.error(`[demo] Could not start local server: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Instant Flurkarte demo running at http://${host}:${port}`);
});

async function handleFlurkarte(request, response) {
  let payload;

  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    return sendJson(response, 400, {
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON."
      }
    });
  }

  try {
    const result = await getFlurkarteDemo({
      address: payload.address,
      bundesland: payload.bundesland || "Thüringen"
    }, { logger: demoLogger });

    return sendJson(response, 200, result);
  } catch (error) {
    const body = error instanceof FlurkarteError
      ? { error: { code: error.code, message: error.message, details: error.details } }
      : { error: { code: "UNKNOWN_ERROR", message: error.message } };

    const status = error instanceof FlurkarteError && ["INVALID_ADDRESS", "UNSUPPORTED_SEARCH"].includes(error.code)
      ? 400
      : error instanceof FlurkarteError && error.code === "ADDRESS_NOT_FOUND"
        ? 404
        : 502;
    return sendJson(response, status, body);
  }
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    return sendText(response, 403, "Forbidden");
  }

  try {
    const body = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}
