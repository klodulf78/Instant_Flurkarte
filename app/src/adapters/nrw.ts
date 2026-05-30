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
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const EPSG_25832_CRS = "http://www.opengis.net/def/crs/EPSG/0/25832";
const REQUEST_TIMEOUT_MS = 40_000;
const POLL_INTERVAL_MS = 1_200;
const MAX_STATUS_POLLS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;
const BANK_CONTEXT_MARGIN_M = 60;
const MAP_FRAME_WIDTH_AT_1000_M = 198;
const MAP_FRAME_HEIGHT_AT_1000_M = 242;
const SCALE_LADDER = [250, 500, 750, 1000, 1500, 2000, 2500] as const;

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
    "adv_alkis_tatsaechliche_nutzung",
    "adv_alkis_flurstuecke",
    "adv_alkis_gebaeude",
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
  "https://www.wms.nrw.de/geobasis/wms_nw_alkis?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=adv_alkis_tatsaechliche_nutzung,adv_alkis_flurstuecke,adv_alkis_gebaeude&CRS=EPSG:25832&BBOX=356360,5645292.5,356734.2,5645646.3&WIDTH=1057&HEIGHT=1000&FORMAT=image/png&STYLES=";

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
  flaeche?: number;
  landschl?: string;
  lagebeztxt?: string;
  tntxt?: string;
}

interface ParcelFeature {
  type: "Feature";
  id?: string;
  properties: ParcelProperties;
  geometry: {
    type: "MultiPolygon" | "Polygon";
    coordinates: unknown;
  };
}

interface ParcelFeatureCollection {
  features?: ParcelFeature[];
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name?: string;
}

interface PrintTarget {
  address: string;
  center: [number, number];
  scale: number;
  flurstueckskennzeichen: string;
  parcel?: ParcelFeature;
  neighbors?: ParcelFeature[];
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
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Flurkarte"
  );
}

function walkNumberPairs(
  coordinates: unknown,
  visit: (x: number, y: number) => void,
): void {
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

function ringAreaAndCentroid(
  ring: [number, number][],
  origin: [number, number],
): {
  area: number;
  centroidX: number;
  centroidY: number;
} {
  if (ring.length < 3) {
    return { area: 0, centroidX: 0, centroidY: 0 };
  }

  let doubleArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let i = 0; i < ring.length; i += 1) {
    const [rawX0, rawY0] = ring[i] ?? [0, 0];
    const [rawX1, rawY1] = ring[(i + 1) % ring.length] ?? [0, 0];
    const x0 = rawX0 - origin[0];
    const y0 = rawY0 - origin[1];
    const x1 = rawX1 - origin[0];
    const y1 = rawY1 - origin[1];
    const cross = x0 * y1 - x1 * y0;
    doubleArea += cross;
    centroidX += (x0 + x1) * cross;
    centroidY += (y0 + y1) * cross;
  }

  const area = doubleArea / 2;
  if (Math.abs(area) < 0.000001) {
    return { area: 0, centroidX: 0, centroidY: 0 };
  }

  return {
    area,
    centroidX: centroidX / (6 * area) + origin[0],
    centroidY: centroidY / (6 * area) + origin[1],
  };
}

function polygonAreaAndCentroid(
  polygon: unknown,
  origin: [number, number],
): {
  area: number;
  centroidX: number;
  centroidY: number;
} {
  if (!Array.isArray(polygon)) {
    return { area: 0, centroidX: 0, centroidY: 0 };
  }

  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const ring of polygon) {
    const ringResult = ringAreaAndCentroid(ringFromUnknown(ring), origin);
    const signedArea = ringResult.area;
    totalArea += signedArea;
    weightedX += ringResult.centroidX * signedArea;
    weightedY += ringResult.centroidY * signedArea;
  }

  if (Math.abs(totalArea) < 0.000001) {
    return { area: 0, centroidX: 0, centroidY: 0 };
  }

  return {
    area: totalArea,
    centroidX: weightedX / totalArea,
    centroidY: weightedY / totalArea,
  };
}

function geometryCentroid(feature: ParcelFeature): [number, number] {
  const bbox = geometryBbox(feature);
  const origin: [number, number] = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : Array.isArray(feature.geometry.coordinates)
        ? feature.geometry.coordinates
        : [];
  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const polygon of polygons) {
    const result = polygonAreaAndCentroid(polygon, origin);
    const area = Math.abs(result.area);
    totalArea += area;
    weightedX += result.centroidX * area;
    weightedY += result.centroidY * area;
  }

  if (totalArea === 0) {
    return origin;
  }

  return [weightedX / totalArea, weightedY / totalArea];
}

function chooseScaleForBbox(bbox: [number, number, number, number]): number {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const neededWidth = width + BANK_CONTEXT_MARGIN_M * 2;
  const neededHeight = height + BANK_CONTEXT_MARGIN_M * 2;
  const requiredScale = Math.max(
    neededWidth / (MAP_FRAME_WIDTH_AT_1000_M / 1000),
    neededHeight / (MAP_FRAME_HEIGHT_AT_1000_M / 1000),
  );

  return (
    SCALE_LADDER.find((scale) => scale >= requiredScale) ??
    SCALE_LADDER[SCALE_LADDER.length - 1]
  );
}

function mapFrameBbox(
  center: [number, number],
  scale: number,
): [number, number, number, number] {
  const width = MAP_FRAME_WIDTH_AT_1000_M * (scale / 1000);
  const height = MAP_FRAME_HEIGHT_AT_1000_M * (scale / 1000);
  return [
    center[0] - width / 2,
    center[1] - height / 2,
    center[0] + width / 2,
    center[1] + height / 2,
  ];
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

function parcelLabel(properties: ParcelProperties): string {
  const flur = properties.flur ?? "?";
  const flurstueck = properties.flstnrzae ?? "?";
  return `Flur ${flur} · Flurstück ${flurstueck}`;
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

async function fetchParcelByProperties(
  properties: ParcelProperties,
): Promise<ParcelFeature> {
  if (!properties.gemarkung || !properties.flur || !properties.flstnrzae) {
    throw new Error("Parcel properties are missing cadastral identifiers.");
  }

  return fetchParcelByCadastralInput({
    gemarkung: properties.gemarkung,
    flur: properties.flur,
    flurstueck: properties.flstnrzae,
  });
}

async function geocodeAddress(address: string): Promise<[number, number]> {
  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "3",
    countrycodes: "de",
    addressdetails: "1",
  });
  const hits = await fetchJsonWithRetry<NominatimHit[]>(
    `${NOMINATIM_SEARCH_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "User-Agent": "InstantFlurkarte/0.1 (https://github.com/klodulf78/Instant_Flurkarte)",
      },
    },
  );
  const hit = hits[0];
  if (!hit) {
    throw new Error(`Address not found: ${address}`);
  }

  const lon = Number(hit.lon);
  const lat = Number(hit.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`Geocoder returned invalid coordinates for ${address}.`);
  }

  return [lon, lat];
}

function ringFromUnknown(ring: unknown): [number, number][] {
  if (!Array.isArray(ring)) {
    return [];
  }
  return ring.flatMap((position) => {
    if (
      Array.isArray(position) &&
      typeof position[0] === "number" &&
      typeof position[1] === "number"
    ) {
      return [[position[0], position[1]] as [number, number]];
    }
    return [];
  });
}

function pointInRing(point: [number, number], ring: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] ?? [0, 0];
    const [xj, yj] = ring[j] ?? [0, 0];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point: [number, number], polygon: unknown): boolean {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return false;
  }

  const outerRing = ringFromUnknown(polygon[0]);
  if (!pointInRing(point, outerRing)) {
    return false;
  }

  for (const hole of polygon.slice(1)) {
    if (pointInRing(point, ringFromUnknown(hole))) {
      return false;
    }
  }

  return true;
}

function pointInFeature(point: [number, number], feature: ParcelFeature): boolean {
  if (feature.geometry.type === "Polygon") {
    return pointInPolygon(point, feature.geometry.coordinates);
  }
  if (!Array.isArray(feature.geometry.coordinates)) {
    return false;
  }
  return feature.geometry.coordinates.some((polygon) =>
    pointInPolygon(point, polygon),
  );
}

function parcelArea(properties: ParcelProperties): number {
  return typeof properties.flaeche === "number" ? properties.flaeche : 0;
}

function isTransportOnlyParcel(properties: ParcelProperties): boolean {
  const text = properties.tntxt ?? "";
  const hasTransport = /Straßenverkehr|Bahnverkehr|Weg/.test(text);
  const hasPrimaryUse = /Wohnbaufläche|Landwirtschaft|Gehölz|Platz|Sport-, Freizeit- und Erholungsfläche/.test(
    text,
  );
  return hasTransport && !hasPrimaryUse;
}

function isPlausibleAddressParcel(feature: ParcelFeature): boolean {
  return (
    parcelArea(feature.properties) >= 20 &&
    !isTransportOnlyParcel(feature.properties)
  );
}

function approximateDistanceMeters(
  a: [number, number],
  b: [number, number],
): number {
  return Math.hypot((a[0] - b[0]) * 70_000, (a[1] - b[1]) * 111_000);
}

function addressFallbackScore(point: [number, number], feature: ParcelFeature): number {
  const properties = feature.properties;
  let score = approximateDistanceMeters(point, geometryCentroid(feature));
  const text = properties.tntxt ?? "";
  const location = properties.lagebeztxt ?? "";

  if (/Wohnbaufläche/.test(text)) {
    score -= 500;
  }
  if (/\d/.test(location)) {
    score -= 250;
  }
  if (!isTransportOnlyParcel(properties)) {
    score -= 100;
  }
  if (parcelArea(properties) >= 100 && parcelArea(properties) <= 3_000) {
    score -= 100;
  }
  if (parcelArea(properties) < 20) {
    score += 500;
  }

  return score;
}

function selectAddressParcel(
  point: [number, number],
  features: ParcelFeature[],
): ParcelFeature | undefined {
  const containingParcel = features.find((feature) =>
    pointInFeature(point, feature),
  );
  if (containingParcel && isPlausibleAddressParcel(containingParcel)) {
    return containingParcel;
  }

  return features
    .filter(isPlausibleAddressParcel)
    .sort(
      (a, b) =>
        addressFallbackScore(point, a) - addressFallbackScore(point, b),
    )[0] ?? containingParcel ?? features[0];
}

async function fetchParcelContainingAddress(address: string): Promise<ParcelFeature> {
  const point = await geocodeAddress(address);
  const delta = 0.0012;
  const params = new URLSearchParams({
    bbox: [
      point[0] - delta,
      point[1] - delta,
      point[0] + delta,
      point[1] + delta,
    ].join(","),
    limit: "30",
    f: "json",
    profile: "rfc7946",
  });
  const collection = await fetchJsonWithRetry<ParcelFeatureCollection>(
    `${OGC_FLURSTUECK_URL}?${params.toString()}`,
    { method: "GET" },
  );
  const features = collection.features ?? [];
  const parcel = selectAddressParcel(point, features);
  if (!parcel) {
    throw new Error(`No NRW parcel found near address: ${address}`);
  }

  return fetchParcelByProperties(parcel.properties);
}

function sameParcel(a: ParcelFeature, b: ParcelFeature): boolean {
  return Boolean(
    a.properties.gemaschl &&
      a.properties.flur &&
      a.properties.flstnrzae &&
      a.properties.gemaschl === b.properties.gemaschl &&
      a.properties.flur === b.properties.flur &&
      a.properties.flstnrzae === b.properties.flstnrzae,
  );
}

function pointInsideBbox(
  point: [number, number],
  bbox: [number, number, number, number],
): boolean {
  return (
    point[0] >= bbox[0] &&
    point[0] <= bbox[2] &&
    point[1] >= bbox[1] &&
    point[1] <= bbox[3]
  );
}

async function fetchNeighborParcels(
  targetParcel: ParcelFeature,
  center: [number, number],
  scale: number,
): Promise<ParcelFeature[]> {
  const printBbox = mapFrameBbox(center, scale);
  const params = new URLSearchParams({
    bbox: printBbox.join(","),
    "bbox-crs": EPSG_25832_CRS,
    crs: EPSG_25832_CRS,
    limit: "50",
    f: "json",
  });
  const collection = await fetchJsonWithRetry<ParcelFeatureCollection>(
    `${OGC_FLURSTUECK_URL}?${params.toString()}`,
    { method: "GET" },
  );

  return (collection.features ?? []).filter((feature) => {
    if (sameParcel(feature, targetParcel)) {
      return false;
    }
    return pointInsideBbox(geometryCentroid(feature), printBbox);
  });
}

async function resolvePrintTarget(input: FlurkarteInput): Promise<PrintTarget> {
  const address = input.address?.trim();
  const parcel = address
    ? await fetchParcelContainingAddress(address)
    : hasCadastralInput(input)
      ? await fetchParcelByCadastralInput(input)
      : undefined;

  if (!parcel) {
    return {
      address: address || PLACEHOLDER_ADDRESS,
      center: HARD_CODED_KOELN_CENTER,
      scale: HARD_CODED_KOELN_SCALE,
      flurstueckskennzeichen: PLACEHOLDER_FLURSTUECKSKENNZEICHEN,
    };
  }

  const bbox = geometryBbox(parcel);
  const center = geometryCentroid(parcel);
  const scale = chooseScaleForBbox(bbox);
  return {
    address: address || parcelAddress(parcel.properties),
    center,
    scale,
    flurstueckskennzeichen: buildFlurstueckskennzeichen(parcel.properties),
    parcel,
    neighbors: await fetchNeighborParcels(parcel, center, scale),
  };
}

function buildTargetParcelLayer(target: PrintTarget): object | undefined {
  if (!target.parcel) {
    return undefined;
  }

  return {
    type: "geojson",
    name: "target-parcel-overlay",
    renderAsSvg: true,
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "target-parcel",
          properties: {},
          geometry: target.parcel.geometry,
        },
        {
          type: "Feature",
          id: "target-label",
          properties: {
            label: parcelLabel(target.parcel.properties),
          },
          geometry: {
            type: "Point",
            coordinates: target.center,
          },
        },
      ],
    },
    style: {
      version: "2",
      "[IN ('target-parcel')]": {
        symbolizers: [
          {
            type: "polygon",
            strokeColor: "#e30613",
            strokeOpacity: 1,
            strokeWidth: 2.5,
            strokeLinejoin: "round",
            fillColor: "#e30613",
            fillOpacity: 0.12,
          },
        ],
      },
      "[IN ('target-label')]": {
        symbolizers: [
          {
            type: "text",
            label: "[label]",
            fontColor: "#000000",
            fontFamily: "sans-serif",
            fontSize: "12px",
            fontWeight: "bold",
            haloColor: "#ffffff",
            haloOpacity: 1,
            haloRadius: 1.5,
            labelAlign: "cm",
            labelXOffset: "0",
            labelYOffset: "0",
            conflictResolution: false,
            goodnessOfFit: 0.1,
            spaceAround: 0,
          },
        ],
      },
    },
  };
}

function buildNeighborLabelLayer(target: PrintTarget): object | undefined {
  const neighbors = target.neighbors ?? [];
  if (neighbors.length === 0) {
    return undefined;
  }

  return {
    type: "geojson",
    name: "neighbor-parcel-labels",
    renderAsSvg: true,
    geoJson: {
      type: "FeatureCollection",
      features: neighbors.map((neighbor, index) => ({
        type: "Feature",
        id: `neighbor-${index}`,
        properties: {
          label: neighbor.properties.flstnrzae ?? "",
        },
        geometry: {
          type: "Point",
          coordinates: geometryCentroid(neighbor),
        },
      })),
    },
    style: {
      version: "2",
      "*": {
        symbolizers: [
          {
            type: "text",
            label: "[label]",
            fontColor: "#333333",
            fontFamily: "sans-serif",
            fontSize: "8px",
            fontStyle: "italic",
            haloColor: "#ffffff",
            haloOpacity: 0.9,
            haloRadius: 1,
            labelAlign: "cm",
            labelXOffset: "0",
            labelYOffset: "0",
            conflictResolution: false,
            goodnessOfFit: 0.1,
            spaceAround: 0,
          },
        ],
      },
    },
  };
}

function buildMapfishSpec(
  target: PrintTarget,
): object {
  const targetLayer = buildTargetParcelLayer(target);
  const neighborLayer = buildNeighborLabelLayer(target);
  const layers = [targetLayer, neighborLayer, ALKIS_WMS_LAYER].filter(
    (layer): layer is object => Boolean(layer),
  );

  return {
    layout: "A4 portrait nc",
    outputFormat: "pdf",
    outputFilename: sanitizeFilename(target.address),
    attributes: {
      title: `Flurkarte_${target.address}`,
      comment: "",
      scale: String(target.scale),
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
        center: target.center,
        scale: target.scale,
        layers,
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
  target: PrintTarget,
): Promise<{ bytes: Uint8Array; downloadUrl: string }> {
  const createResponse = await fetchJsonWithRetry<MapfishCreateResponse>(
    MAPFISH_PRINT_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildMapfishSpec(target)),
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

    return { bytes: pdfBytes, downloadUrl };
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
    milestone: "B5-highlight-label-v3",
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
      const { bytes: pdfBytes, downloadUrl } = await fetchTimOnlinePdf(target);
      const result = {
        ...baseResult,
        source: TIM_ONLINE_SOURCE,
        pdfUrl: toPdfDataUrl(pdfBytes),
        pdfDownloadUrl: downloadUrl,
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
