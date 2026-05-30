import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type {
  FlurkarteAdapter,
  FlurkarteInput,
  FlurkarteResult,
} from "../shared/contract.js";

const TIM_ONLINE_ORIGIN = "https://www.tim-online.nrw.de";
const MAPFISH_PRINT_URL = `${TIM_ONLINE_ORIGIN}/mapfish-print/print/timonline_templates/report.pdf`;
const OGC_FLURSTUECK_URL =
  "https://ogc-api.nrw.de/lika/v1/collections/flurstueck/items";
const EPSG_25832_CRS = "http://www.opengis.net/def/crs/EPSG/0/25832";
const REQUEST_TIMEOUT_MS = 40_000;
const POLL_INTERVAL_MS = 1_200;
const MAX_STATUS_POLLS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;

const PLACEHOLDER_ADDRESS = "Domkloster 4, 50667 Koeln";
const PLACEHOLDER_FLURSTUECKSKENNZEICHEN = "NRW-B1-KOELN-HARDCODED";
const TIM_ONLINE_SOURCE = "TIM-online / Geobasis NRW";
const FALLBACK_SOURCE = "Geobasis NRW (ALKIS WMS fallback)";

const HARD_CODED_KOELN_CENTER: [number, number] = [356547.045, 5645285.3475];
const HARD_CODED_KOELN_SCALE = 1000;

const ALKIS_WMS_LAYER = {
  type: "wms",
  baseURL: "https://www.wms.nrw.de/geobasis/wms_nw_alkis",
  layers: [
    "adv_alkis_flurstuecke",
    "adv_alkis_gebaeude",
    "adv_alkis_tatsaechliche_nutzung",
  ],
  imageFormat: "image/png",
  customParams: { TRANSPARENT: "true" },
  version: "1.3.0",
};

const NRW_OVERVIEW_LAYER = {
  type: "wms",
  baseURL: "https://www.wms.nrw.de/geobasis/wms_nw_nrw_uebersicht",
  layers: ["nw_nrw_uebersicht_5000_utm32"],
  imageFormat: "image/png",
  version: "1.3.0",
};

const WMS_GET_MAP_URL =
  "https://www.wms.nrw.de/geobasis/wms_nw_alkis?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=adv_alkis_flurstuecke,adv_alkis_gebaeude,adv_alkis_tatsaechliche_nutzung&CRS=EPSG:25832&BBOX=356360,5645292.5,356734.2,5645646.3&WIDTH=1057&HEIGHT=1000&FORMAT=image/png&STYLES=";

interface CacheEntry {
  expiresAt: number;
  result: FlurkarteResult;
}

interface MapfishCreateResponse {
  ref?: string;
  statusURL?: string;
  downloadURL?: string;
}

interface MapfishStatusResponse {
  done?: boolean;
  status?: string;
  error?: string;
}

interface ParcelProperties {
  gemarkung?: string;
  gemaschl?: string;
  flur?: string;
  flstnrzae?: string;
  landschl?: string;
  lagebeztxt?: string;
}

interface ParcelFeature {
  type: "Feature";
  properties: ParcelProperties;
  geometry: {
    type: "MultiPolygon" | "Polygon";
    coordinates: unknown;
  };
}

interface ParcelFeatureCollection {
  features?: ParcelFeature[];
}

interface PrintTarget {
  address: string;
  center: [number, number];
  scale: number;
  flurstueckskennzeichen: string;
}

const resultCache = new Map<string, CacheEntry>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await delay(750);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });
  return (await response.json()) as T;
}

async function fetchBytesWithRetry(
  url: string,
  init: RequestInit,
): Promise<Uint8Array> {
  const response = await fetchWithRetry(url, init);
  return new Uint8Array(await response.arrayBuffer());
}

function absoluteTimOnlineUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, TIM_ONLINE_ORIGIN).toString();
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function walkNumberPairs(coordinates: unknown, visit: (x: number, y: number) => void): void {
  if (!Array.isArray(coordinates)) {
    return;
  }
  const [first, second] = coordinates;
  if (typeof first === "number" && typeof second === "number") {
    visit(first, second);
    return;
  }
  for (const child of coordinates) {
    walkNumberPairs(child, visit);
  }
}

function geometryBbox(feature: ParcelFeature): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  walkNumberPairs(feature.geometry.coordinates, (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    throw new Error("Parcel geometry did not contain valid EPSG:25832 coordinates.");
  }

  return [minX, minY, maxX, maxY];
}

function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function chooseScaleForBbox(bbox: [number, number, number, number]): number {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const maxDimension = Math.max(width, height);
  return maxDimension <= 80 ? 500 : 1000;
}

function buildFlurstueckskennzeichen(properties: ParcelProperties): string {
  const parts = [
    properties.landschl,
    properties.gemaschl,
    properties.flur,
    properties.flstnrzae,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("-") : PLACEHOLDER_FLURSTUECKSKENNZEICHEN;
}

function parcelAddress(properties: ParcelProperties): string {
  const location = [properties.lagebeztxt, properties.gemarkung]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return location || PLACEHOLDER_ADDRESS;
}

function flurstueckZae(value: string): string {
  return value.trim().split(/[/-]/, 1)[0] ?? value.trim();
}

function hasCadastralInput(input: FlurkarteInput): boolean {
  return Boolean(input.gemarkung?.trim() && input.flur?.trim() && input.flurstueck?.trim());
}

async function fetchParcelByCadastralInput(
  input: FlurkarteInput,
): Promise<ParcelFeature> {
  if (!input.gemarkung || !input.flur || !input.flurstueck) {
    throw new Error("Missing cadastral input.");
  }

  const params = new URLSearchParams({
    gemarkung: input.gemarkung.trim(),
    flur: input.flur.trim(),
    flstnrzae: flurstueckZae(input.flurstueck),
    limit: "10",
    crs: EPSG_25832_CRS,
    f: "json",
  });
  const collection = await fetchJsonWithRetry<ParcelFeatureCollection>(
    `${OGC_FLURSTUECK_URL}?${params.toString()}`,
    { method: "GET" },
  );
  const features = collection.features ?? [];
  const parcel = features.find((feature) => {
    const properties = feature.properties;
    return (
      properties.gemarkung === input.gemarkung?.trim() &&
      properties.flur === input.flur?.trim() &&
      properties.flstnrzae === flurstueckZae(input.flurstueck ?? "")
    );
  }) ?? features[0];

  if (!parcel) {
    throw new Error(
      `No NRW parcel found for ${input.gemarkung} Flur ${input.flur} Flurstueck ${input.flurstueck}.`,
    );
  }

  return parcel;
}

async function resolvePrintTarget(input: FlurkarteInput): Promise<PrintTarget> {
  if (!hasCadastralInput(input)) {
    return {
      address: input.address?.trim() || PLACEHOLDER_ADDRESS,
      center: HARD_CODED_KOELN_CENTER,
      scale: HARD_CODED_KOELN_SCALE,
      flurstueckskennzeichen: PLACEHOLDER_FLURSTUECKSKENNZEICHEN,
    };
  }

  const parcel = await fetchParcelByCadastralInput(input);
  const bbox = geometryBbox(parcel);
  return {
    address: input.address?.trim() || parcelAddress(parcel.properties),
    center: bboxCenter(bbox),
    scale: chooseScaleForBbox(bbox),
    flurstueckskennzeichen: buildFlurstueckskennzeichen(parcel.properties),
  };
}

function buildMapfishSpec(
  address: string,
  center: [number, number],
  scale: number,
): object {
  return {
    layout: "A4 portrait nc",
    outputFormat: "pdf",
    outputFilename: sanitizeFilename(address),
    attributes: {
      title: `Flurkarte_${address}`,
      comment: "",
      scale: String(scale),
      datasource: [
        {
          table: {
            columns: ["url", "layer", "fees", "accessConstraints"],
            data: [
              [
                "https://www.wms.nrw.de/geobasis/wms_nw_alkis",
                "ALKIS",
                "Datenlizenz Deutschland Zero",
                "Datenlizenz Deutschland Zero",
              ],
            ],
          },
        },
      ],
      map: {
        projection: "EPSG:25832",
        dpi: 127,
        rotation: 0,
        center,
        scale,
        layers: [ALKIS_WMS_LAYER],
      },
      overviewMap: {
        projection: "EPSG:25832",
        dpi: 127,
        rotation: 0,
        bbox: [288300, 5551800, 524700, 5842200],
        layers: [NRW_OVERVIEW_LAYER],
      },
    },
  };
}

async function fetchTimOnlinePdf(
  address: string,
  center: [number, number],
  scale: number,
): Promise<Uint8Array> {
  const createResponse = await fetchJsonWithRetry<MapfishCreateResponse>(
    MAPFISH_PRINT_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildMapfishSpec(address, center, scale)),
    },
  );

  if (!createResponse.ref) {
    throw new Error("TIM-online MapFish response did not include a ref.");
  }

  const statusUrl = absoluteTimOnlineUrl(
    createResponse.statusURL ??
      `/mapfish-print/print/status/${createResponse.ref}.json`,
  );
  const downloadUrl = absoluteTimOnlineUrl(
    createResponse.downloadURL ??
      `/mapfish-print/print/report/${createResponse.ref}`,
  );

  for (let poll = 0; poll < MAX_STATUS_POLLS; poll += 1) {
    if (poll > 0) {
      await delay(POLL_INTERVAL_MS);
    }

    const status = await fetchJsonWithRetry<MapfishStatusResponse>(statusUrl, {
      method: "GET",
    });

    if (!status.done) {
      continue;
    }
    if (status.status !== "finished") {
      throw new Error(
        `TIM-online MapFish failed: ${status.status ?? "unknown"} ${status.error ?? ""}`.trim(),
      );
    }

    const pdfBytes = await fetchBytesWithRetry(downloadUrl, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
    if (pdfBytes.byteLength === 0) {
      throw new Error("TIM-online returned an empty PDF.");
    }
    if (Buffer.from(pdfBytes.subarray(0, 4)).toString("ascii") !== "%PDF") {
      throw new Error("TIM-online download was not a PDF.");
    }

    return pdfBytes;
  }

  throw new Error("TIM-online MapFish print timed out.");
}

async function fetchWmsPng(): Promise<Uint8Array> {
  const response = await fetchWithRetry(WMS_GET_MAP_URL, {
    method: "GET",
    headers: { Accept: "image/png" },
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("image/png")) {
    throw new Error(
      `ALKIS WMS returned ${contentType || "unknown content type"} (${bytes.byteLength} bytes)`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new Error("ALKIS WMS returned an empty PNG.");
  }

  return bytes;
}

function pdfSafeText(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?");
}

async function composeFallbackPdf(
  pngBytes: Uint8Array,
  result: Omit<FlurkarteResult, "pdfUrl">,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Instant Flurkarte fallback");
  pdfDoc.setAuthor("Instant Flurkarte");
  pdfDoc.setSubject("Fallback NRW ALKIS WMS PDF");
  pdfDoc.setCreationDate(new Date(result.extractedAt));
  pdfDoc.setModificationDate(new Date(result.extractedAt));

  const page = pdfDoc.addPage([595.28, 841.89]);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 28;
  const headerHeight = 96;

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mapImage = await pdfDoc.embedPng(pngBytes);

  const headerY = pageHeight - margin - headerHeight;
  page.drawRectangle({
    x: margin,
    y: headerY,
    width: pageWidth - margin * 2,
    height: headerHeight,
    color: rgb(0.95, 0.96, 0.94),
    borderColor: rgb(0.18, 0.22, 0.2),
    borderWidth: 1,
  });

  page.drawText("Instant Flurkarte", {
    x: margin + 14,
    y: headerY + headerHeight - 27,
    size: 16,
    font: boldFont,
    color: rgb(0.07, 0.09, 0.08),
  });
  page.drawText(`Bundesland: ${result.bundesland}`, {
    x: margin + 14,
    y: headerY + 48,
    size: 10,
    font: regularFont,
    color: rgb(0.07, 0.09, 0.08),
  });
  page.drawText(`Adresse: ${pdfSafeText(result.address)}`, {
    x: margin + 14,
    y: headerY + 31,
    size: 10,
    font: regularFont,
    color: rgb(0.07, 0.09, 0.08),
  });
  page.drawText(`Quelle: ${result.source}`, {
    x: pageWidth / 2,
    y: headerY + 48,
    size: 10,
    font: regularFont,
    color: rgb(0.07, 0.09, 0.08),
  });
  page.drawText(`Auszug: ${result.extractedAt}`, {
    x: pageWidth / 2,
    y: headerY + 31,
    size: 10,
    font: regularFont,
    color: rgb(0.07, 0.09, 0.08),
  });
  page.drawText(
    `Flurstueckskennzeichen: ${result.flurstueckskennzeichen}`,
    {
      x: margin + 14,
      y: headerY + 14,
      size: 9,
      font: regularFont,
      color: rgb(0.07, 0.09, 0.08),
    },
  );

  const maxMapWidth = pageWidth - margin * 2;
  const maxMapHeight = headerY - margin * 2;
  const imageSize = mapImage.scale(1);
  const imageScale = Math.min(
    maxMapWidth / imageSize.width,
    maxMapHeight / imageSize.height,
  );
  const mapWidth = imageSize.width * imageScale;
  const mapHeight = imageSize.height * imageScale;
  const mapX = margin + (maxMapWidth - mapWidth) / 2;
  const mapY = headerY - margin - mapHeight;

  page.drawImage(mapImage, {
    x: mapX,
    y: mapY,
    width: mapWidth,
    height: mapHeight,
  });
  page.drawRectangle({
    x: mapX,
    y: mapY,
    width: mapWidth,
    height: mapHeight,
    borderColor: rgb(0.18, 0.22, 0.2),
    borderWidth: 1,
  });

  return pdfDoc.save();
}

function toPdfDataUrl(pdfBytes: Uint8Array): string {
  return `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`;
}

function normalizeBundesland(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function cacheKey(input: FlurkarteInput): string {
  return JSON.stringify({
    milestone: "B2",
    address: input.address?.trim() || PLACEHOLDER_ADDRESS,
    bundesland: normalizeBundesland(input.bundesland) || "nrw",
    gemarkung: input.gemarkung?.trim() || "",
    flur: input.flur?.trim() || "",
    flurstueck: input.flurstueck?.trim() || "",
  });
}

function getCachedResult(key: string): FlurkarteResult | undefined {
  const entry = resultCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return undefined;
  }
  return entry.result;
}

function setCachedResult(key: string, result: FlurkarteResult): void {
  resultCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });
}

export const nrwAdapter: FlurkarteAdapter = {
  bundesland: "NRW",

  canHandle(input: FlurkarteInput): boolean {
    const bundesland = normalizeBundesland(input.bundesland);
    return (
      bundesland === undefined ||
      bundesland === "" ||
      bundesland === "nrw" ||
      bundesland === "nordrhein-westfalen"
    );
  },

  async getFlurkarte(input: FlurkarteInput): Promise<FlurkarteResult> {
    const key = cacheKey(input);
    const cached = getCachedResult(key);
    if (cached) {
      return cached;
    }

    const target = await resolvePrintTarget(input);
    const extractedAt = new Date().toISOString();
    const baseResult = {
      flurstueckskennzeichen: target.flurstueckskennzeichen,
      address: target.address,
      bundesland: "NRW",
      extractedAt,
    };

    try {
      const pdfBytes = await fetchTimOnlinePdf(
        target.address,
        target.center,
        target.scale,
      );
      const result = {
        ...baseResult,
        source: TIM_ONLINE_SOURCE,
        pdfUrl: toPdfDataUrl(pdfBytes),
      };
      setCachedResult(key, result);
      return result;
    } catch (error) {
      console.warn("TIM-online MapFish failed; using WMS fallback.", error);
      const pngBytes = await fetchWmsPng();
      const fallbackBaseResult = {
        ...baseResult,
        source: FALLBACK_SOURCE,
      };
      const pdfBytes = await composeFallbackPdf(pngBytes, fallbackBaseResult);
      const result = {
        ...fallbackBaseResult,
        pdfUrl: toPdfDataUrl(pdfBytes),
      };
      setCachedResult(key, result);
      return result;
    }
  },
};
