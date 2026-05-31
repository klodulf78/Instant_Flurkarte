import type {
  FlurkarteAdapter,
  FlurkarteInput,
  FlurkarteResult,
} from '../shared/contract.js';

const SOURCE = "InfoLika / Thüringen Viewer";
const BUNDESLAND = "Thüringen";

const ADDRESS_WFS_URL = "https://www.geoproxy.geoportal-th.de/geoproxy/services";
const PARCEL_WFS_URL = "https://www.geoproxy.geoportal-th.de/geoproxy/services/alkis_onlika_wfs";
const INFO_FKZ_URL = "https://www.geoproxy.geoportal-th.de/geoproxy/services/il_show_fkz";
const PRINT_CREATE_URL = "https://www.geoproxy.geoportal-th.de/geoengine/create.json";
const ALKIS_WMS_URL = "https://www.geoproxy.geoportal-th.de/geoproxy/services/ALKISINFOLIKA?client=infolika";

const PRINT_DPI = 196;
const PRINT_SCALE = 1000;
const PRINT_LAYOUT = `InfoLIKA A4 hoch ${PRINT_SCALE}`;
const PRINT_LAYOUT_SIZE = { width: 525, height: 644 };
const INCHES_PER_METER = 39.37;
const FRIENDLY_ADDRESS_ERROR = "Please enter a street, house number and city in Thüringen.";

const HOUSE_NUMBER_PATTERN = "\\d{1,4}\\s*[a-zA-Z]?(?:\\s*(?:[-/])\\s*\\d{1,4}\\s*[a-zA-Z]?)?";
const THURINGIA_POSTCODE_TOWNS = new Map([
  ["99084", "Erfurt"],
  ["99085", "Erfurt"],
  ["99086", "Erfurt"],
  ["99087", "Erfurt"],
  ["99089", "Erfurt"],
  ["99091", "Erfurt"],
  ["99092", "Erfurt"],
  ["99094", "Erfurt"],
  ["99096", "Erfurt"],
  ["99097", "Erfurt"],
  ["99098", "Erfurt"],
  ["99099", "Erfurt"],
  ["07743", "Jena"],
  ["07745", "Jena"],
  ["07747", "Jena"],
  ["07749", "Jena"],
  ["99423", "Weimar"],
  ["99425", "Weimar"],
  ["99427", "Weimar"],
  ["07545", "Gera"],
  ["07546", "Gera"],
  ["07548", "Gera"],
  ["07549", "Gera"],
  ["07551", "Gera"],
  ["07552", "Gera"],
  ["07554", "Gera"],
  ["99817", "Eisenach"],
  ["98527", "Suhl"],
  ["98528", "Suhl"],
  ["98529", "Suhl"],
  ["98693", "Ilmenau"],
  ["07407", "Rudolstadt"],
  ["07318", "Saalfeld/Saale"],
  ["04600", "Altenburg"],
  ["99734", "Nordhausen"],
  ["99947", "Bad Langensalza"],
  ["99974", "Mühlhausen"],
  ["37308", "Heilbad Heiligenstadt"],
  ["98574", "Schmalkalden"],
  ["36433", "Bad Salzungen"],
  ["98617", "Meiningen"]
]);

const THURINGIA_TOWNS = [
  ...new Set(THURINGIA_POSTCODE_TOWNS.values())
].sort((left, right) => normalize(right).length - normalize(left).length);

const STREET_TOWN_HINTS = new Map([
  ["grosse arche", "Erfurt"],
  ["große arche", "Erfurt"],
  ["kleine arche", "Erfurt"]
]);

class FlurkarteError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FlurkarteError";
    this.code = code;
    this.details = details;
  }
}

interface ParsedAddress {
  street: string;
  houseNumber: string;
  postalCode: string | null;
  town: string;
}

interface Town {
  id: string;
  name: string;
}

interface Street {
  id: string;
  name: string;
}

interface House {
  id: string;
  name: string;
  coordinate: [number, number];
}

interface Parcel {
  flurstueckskennzeichen: string;
  identifier: string;
  bounds: { minx: number; miny: number; maxx: number; maxy: number };
  rawXml: string;
}

interface ParcelInfo {
  address: string | null;
  kreis: string;
  gemeinde: string;
  gemarkung: string;
  flur: string;
  kennzeichen: string;
}

function normalize(value: string): string {
  return compactText(value)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function compactText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    auml: "ä",
    Auml: "Ä",
    ouml: "ö",
    Ouml: "Ö",
    uuml: "ü",
    Uuml: "Ü",
    szlig: "ß"
  };

  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => named[name] ?? match);
}

function cleanComponent(value: string): string {
  return String(value ?? "")
    .replace(/[;|]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHouseNumber(value: string): string {
  return cleanComponent(value).replace(/\s*([-/])\s*/g, "$1").replace(/\s+/g, "");
}

function isUsefulAddressPart(value: string): boolean {
  return /\p{Letter}/u.test(value);
}

function cleanAddressText(value: string): string {
  return cleanComponent(String(value)
    .replace(/\s+-\s+[^,]+$/, "")
    .replace(/\b(deutschland|germany)\b/giu, " "));
}

function extractHouseNumber(value: string): { houseNumber: string; before: string; after: string } | null {
  const matches = [...String(value).matchAll(new RegExp(`(?:^|\\s)(${HOUSE_NUMBER_PATTERN})(?=$|\\s|,)`, "giu"))];
  const match = matches.at(-1);
  if (!match) {
    return null;
  }

  const leadingWhitespace = match[0].match(/^\s/) ? 1 : 0;
  const start = match.index + leadingWhitespace;
  const houseNumber = match[1];

  return {
    houseNumber,
    before: value.slice(0, start),
    after: value.slice(start + houseNumber.length)
  };
}

function parseCommaAddress(value: string): { street: string; houseNumber: string; town: string } | null {
  const segments = value.split(",").map(cleanComponent).filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const houseSegmentIndex = segments.findIndex((segment) => extractHouseNumber(segment));
  if (houseSegmentIndex === -1) {
    return null;
  }

  const house = extractHouseNumber(segments[houseSegmentIndex]);
  if (!house) return null;

  const otherSegments = segments.filter((_, index) => index !== houseSegmentIndex);
  const town = cleanComponent(otherSegments.join(" "));
  const street = cleanComponent(house.before || house.after);

  return {
    street,
    houseNumber: house.houseNumber,
    town: town || cleanComponent(house.after)
  };
}

function parseLooseAddress(value: string): { street: string; houseNumber: string; town: string } | null {
  const house = extractHouseNumber(value);
  if (!house) {
    return null;
  }

  const before = cleanComponent(house.before);
  const after = cleanComponent(house.after);
  if (before && after) {
    return {
      street: before,
      houseNumber: house.houseNumber,
      town: after
    };
  }

  const singleSide = before || after;
  const split = splitTownAndStreet(singleSide);
  if (split) {
    return {
      street: split.street,
      houseNumber: house.houseNumber,
      town: split.town
    };
  }

  return {
    street: singleSide,
    houseNumber: house.houseNumber,
    town: ""
  };
}

function splitTownAndStreet(value: string): { street: string; town: string } | null {
  const cleaned = cleanComponent(value);
  const normalized = normalize(cleaned);
  const parts = cleaned.split(/\s+/);

  for (const town of THURINGIA_TOWNS) {
    const normalizedTown = normalize(town);
    const townLength = town.split(/\s+/).length;

    if (normalized.startsWith(`${normalizedTown} `)) {
      return {
        town,
        street: cleanComponent(parts.slice(townLength).join(" "))
      };
    }

    if (normalized.endsWith(` ${normalizedTown}`)) {
      return {
        town,
        street: cleanComponent(parts.slice(0, -townLength).join(" "))
      };
    }
  }

  return null;
}

function inferTownFromStreet(street: string): string {
  return STREET_TOWN_HINTS.get(normalize(street)) || "";
}

function parseAddressInput(address: string): ParsedAddress {
  const original = String(address ?? "");
  const normalizedInput = cleanAddressText(original);
  const postalCode = normalizedInput.match(/\b\d{5}\b/)?.[0] || null;
  const withoutPostalCode = cleanComponent(normalizedInput.replace(/\b\d{5}\b/g, " "));
  const parsed = parseCommaAddress(withoutPostalCode) || parseLooseAddress(withoutPostalCode);

  if (!parsed) {
    throw new FlurkarteError("INVALID_ADDRESS", FRIENDLY_ADDRESS_ERROR, { address: original });
  }

  const resolved: ParsedAddress = {
    street: cleanComponent(parsed.street),
    houseNumber: cleanHouseNumber(parsed.houseNumber),
    postalCode,
    town: cleanComponent(parsed.town)
  };

  if (!resolved.town && resolved.postalCode) {
    resolved.town = THURINGIA_POSTCODE_TOWNS.get(resolved.postalCode) || "";
  }

  if (!resolved.town) {
    resolved.town = inferTownFromStreet(resolved.street);
  }

  if (!isUsefulAddressPart(resolved.street) || !resolved.houseNumber || !isUsefulAddressPart(resolved.town)) {
    throw new FlurkarteError("INVALID_ADDRESS", FRIENDLY_ADDRESS_ERROR, { address: original });
  }

  return resolved;
}

function formatAddress(address: ParsedAddress): string {
  const postalTown = [address.postalCode, address.town].filter(Boolean).join(" ");
  return `${address.street} ${address.houseNumber}, ${postalTown}`.trim();
}

function normalizeHouseNumber(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function urlWithParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function xmlMembers(xml: string): string[] {
  return [...xml.matchAll(/<(?:[A-Za-z0-9_.-]+:)?member\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?member>/gi)]
    .map((match) => match[1]);
}

function textFromTag(xml: string, localName: string): string {
  const escaped = escapeRegExp(localName);
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escaped}>`,
    "i"
  );
  const match = xml.match(pattern);
  return match ? compactText(stripHtml(match[1])) : "";
}

function stripHtml(value: string): string {
  return decodeEntities(String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePoint(value: string): [number, number] | null {
  const parts = value.split(/\s+/).map(Number).filter(Number.isFinite);
  return parts.length >= 2 ? [parts[0], parts[1]] : null;
}

function parseBounds(xml: string): { minx: number; miny: number; maxx: number; maxy: number } {
  const head = xml.split(/<(?:[A-Za-z0-9_.-]+:)?member\b/i)[0];
  const coordinates = textFromTag(head, "coordinates");

  if (coordinates) {
    const pairs = coordinates.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
    if (pairs.length >= 2 && pairs[0].every(Number.isFinite) && pairs[1].every(Number.isFinite)) {
      return {
        minx: pairs[0][0],
        miny: pairs[0][1],
        maxx: pairs[1][0],
        maxy: pairs[1][1]
      };
    }
  }

  const lower = parsePoint(textFromTag(head, "lowerCorner"));
  const upper = parsePoint(textFromTag(head, "upperCorner"));
  if (lower && upper) {
    return {
      minx: lower[0],
      miny: lower[1],
      maxx: upper[0],
      maxy: upper[1]
    };
  }

  throw new FlurkarteError("PARCEL_LOOKUP_FAILED", "Parcel lookup did not include a usable bounding box.");
}

function formattedFkz(rawFkz: string): string {
  if (!rawFkz || rawFkz.length < 18) {
    return rawFkz || "";
  }

  return `Flurstück ${rawFkz.slice(9, 14).replace(/^0+/, "") || rawFkz.slice(9, 14)}`;
}

function addressWfsParams(extra: Record<string, string>): Record<string, string> {
  return {
    REQUEST: "GetFeature",
    SERVICE: "WFS",
    SRSNAME: "EPSG:25832",
    TYPENAMES: "tlvermgeo:GAZHKO_STREET",
    VERSION: "2.0.0",
    ...extra
  };
}

function chooseSingle<T extends { name: string }>(
  candidates: T[],
  requested: string,
  label: string,
  notFoundCode: string
): T {
  if (candidates.length === 0) {
    throw new FlurkarteError(notFoundCode, `Address not found: no ${label} result was returned.`, {
      requested
    });
  }

  const exact = candidates.filter((candidate) => normalize(candidate.name) === normalize(requested));
  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new FlurkarteError("MULTIPLE_SEARCH_RESULTS", `Multiple ${label} search results matched the address.`, {
      requested,
      results: exact.map((candidate) => candidate.name)
    });
  }

  const contains = candidates.filter((candidate) => normalize(candidate.name).includes(normalize(requested)));
  if (contains.length === 1) {
    return contains[0];
  }

  if (contains.length > 1) {
    throw new FlurkarteError("MULTIPLE_SEARCH_RESULTS", `Multiple ${label} search results matched the address.`, {
      requested,
      results: contains.slice(0, 20).map((candidate) => candidate.name)
    });
  }

  throw new FlurkarteError(notFoundCode, `Address not found: no ${label} matched the address.`, {
    requested,
    sampleResults: candidates.slice(0, 20).map((candidate) => candidate.name)
  });
}

async function getText(url: string, label: string): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/xml,text/xml,text/html,*/*",
      "User-Agent": "Instant-Flurkarte-Hackathon/0.1"
    }
  }, {
    code: "PORTAL_UNAVAILABLE",
    message: `InfoLika portal unavailable during ${label}.`
  });

  if (!response.ok) {
    throw new FlurkarteError("PORTAL_UNAVAILABLE", `InfoLika portal returned HTTP ${response.status} during ${label}.`, {
      url: String(url),
      status: response.status
    });
  }

  return response.text();
}

async function postText(url: string, body: string, label: string): Promise<string> {
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/json,*/*",
      "User-Agent": "Instant-Flurkarte-Hackathon/0.1"
    },
    body
  }, {
    code: "PDF_GENERATION_FAILED",
    message: `Official PDF generation failed during ${label}.`
  });

  if (!response.ok) {
    throw new FlurkarteError("PDF_GENERATION_FAILED", `Official PDF generation returned HTTP ${response.status}.`, {
      url,
      status: response.status,
      response: (await response.text()).slice(0, 500)
    });
  }

  return response.text();
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  errorInfo: { code: string; message: string }
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000)
      });

      if (response.status < 500 || attempt === 3) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
    }

    await delay(250 * attempt);
  }

  throw new FlurkarteError(errorInfo.code, errorInfo.message, {
    url: String(url),
    cause: (lastError as Error)?.cause?.message || (lastError as Error)?.message || "unknown error"
  });
}

async function findTown(townName: string): Promise<Town> {
  console.log(`[Thüringen] Requesting municipality candidates: ${townName}`);
  const xml = await getText(
    urlWithParams(ADDRESS_WFS_URL, addressWfsParams({
      StoredQuery_ID: "findeGemeinde",
      gemeinde: townName
    })),
    "municipality search"
  );

  const towns = xmlMembers(xml).map((member) => ({
    id: textFromTag(member, "gemkennzahl"),
    name: textFromTag(member, "gemeindename")
  })).filter((town) => town.id && town.name);

  return chooseSingle(towns, townName, "municipality", "ADDRESS_NOT_FOUND");
}

async function findStreet(townId: string, streetName: string): Promise<Street> {
  console.log(`[Thüringen] Requesting street candidates: ${streetName}`);
  const xml = await getText(
    urlWithParams(ADDRESS_WFS_URL, addressWfsParams({
      StoredQuery_ID: "findeStrasse",
      gemkennzahl: townId
    })),
    "street search"
  );

  const streets = xmlMembers(xml).map((member) => ({
    id: textFromTag(member, "strkscomid"),
    name: textFromTag(member, "strasse")
  })).filter((street) => street.id && street.name);

  return chooseSingle(streets, streetName, "street", "ADDRESS_NOT_FOUND");
}

async function findHouseNumber(streetId: string, houseNumber: string): Promise<House> {
  console.log(`[Thüringen] Requesting house-number candidates: ${houseNumber}`);
  const xml = await getText(
    urlWithParams(ADDRESS_WFS_URL, addressWfsParams({
      StoredQuery_ID: "findeHausnummer",
      strkscomid: streetId,
      hausnr: ""
    })),
    "house-number search"
  );

  const houses = xmlMembers(xml).map((member) => {
    const number = textFromTag(member, "hausnr");
    const suffix = textFromTag(member, "zusatz");
    return {
      id: `${number}${suffix || ""}`,
      name: `${number}${suffix || ""}`,
      coordinate: parsePoint(textFromTag(member, "pos")) as [number, number]
    };
  }).filter((house) => house.name && house.coordinate);

  const exact = houses.filter((house) => normalizeHouseNumber(house.name) === normalizeHouseNumber(houseNumber));
  if (exact.length === 1) {
    return exact[0];
  }

  if (exact.length > 1) {
    throw new FlurkarteError("MULTIPLE_SEARCH_RESULTS", "Multiple house-number search results matched the address.", {
      requested: houseNumber,
      results: exact.map((house) => house.name)
    });
  }

  // Fallback: try to match parts of the house number (e.g., "7/9" -> "7" or "9")
  const parts = houseNumber.split(/[-/]/);
  for (const part of parts) {
    const partialMatch = houses.filter((house) => normalizeHouseNumber(house.name) === normalizeHouseNumber(part));
    if (partialMatch.length === 1) {
      console.warn(`[Thüringen] Using partial house number match: ${part} instead of ${houseNumber}`);
      return partialMatch[0];
    }
  }

  // Fallback: use the nearest available house number
  const requestedNum = parseInt(houseNumber.replace(/\D/g, ''), 10);
  if (!isNaN(requestedNum)) {
    const nearest = houses
      .map((house) => {
        const houseNum = parseInt(house.name.replace(/\D/g, ''), 10);
        const diff = isNaN(houseNum) ? Infinity : Math.abs(houseNum - requestedNum);
        return { house, diff };
      })
      .filter((item) => item.diff !== Infinity)
      .sort((a, b) => a.diff - b.diff)[0];

    if (nearest && nearest.diff <= 10) {
      console.warn(`[Thüringen] Using nearest house number: ${nearest.house.name} instead of ${houseNumber} (difference: ${nearest.diff})`);
      return nearest.house;
    }
  }

  console.warn(`[Thüringen] Address not found: house number did not match any result`, {
    requested: houseNumber,
    available: houses.slice(0, 20).map((house) => house.name)
  });
  throw new FlurkarteError("ADDRESS_NOT_FOUND", "Address not found: house number did not match any InfoLika result.", {
    requested: houseNumber
  });
}

async function findParcelByCoordinate(coordinate: [number, number]): Promise<Parcel> {
  for (const epsilon of [0.001, 1]) {
    const [x, y] = coordinate;
    const params: Record<string, string> = {
      REQUEST: "GetFeature",
      SERVICE: "WFS",
      SRSNAME: "EPSG:25832",
      CRS: "25832",
      minX: String(x),
      minY: String(y),
      maxX: String(x + epsilon),
      maxY: String(y + epsilon),
      TYPENAMES: "adv:EX_Flurstueck",
      VERSION: "2.0.0",
      StoredQuery_ID: "findeONLIKAFKZByBBox",
      outputFormat: "text/xml; subtype=gml/2.1.2"
    };

    console.log(`[Thüringen] Requesting parcel by address coordinate: ${coordinate}, epsilon: ${epsilon}`);
    const xml = await getText(urlWithParams(PARCEL_WFS_URL, params), "parcel lookup");
    const members = xmlMembers(xml);

    if (members.length === 0) {
      continue;
    }

    if (members.length > 1) {
      console.warn(`[Thüringen] Multiple parcels matched the coordinate; using the first result`, {
        count: members.length
      });
    }

    const member = members[0];
    const parcel: Parcel = {
      flurstueckskennzeichen: textFromTag(member, "Flurstueckskennzeichen"),
      identifier: textFromTag(member, "identifier"),
      bounds: parseBounds(xml),
      rawXml: xml
    };

    if (!parcel.flurstueckskennzeichen || !parcel.identifier) {
      throw new FlurkarteError("PARCEL_LOOKUP_FAILED", "Parcel lookup returned an incomplete InfoLika response.", {
        hasFlurstueckskennzeichen: Boolean(parcel.flurstueckskennzeichen),
        hasIdentifier: Boolean(parcel.identifier)
      });
    }

    console.log(`[Thüringen] Parcel found: ${parcel.flurstueckskennzeichen}, ${parcel.identifier}`);
    return parcel;
  }

  throw new FlurkarteError("ADDRESS_NOT_FOUND", "Address found, but no parcel matched the address coordinate.");
}

async function fetchParcelInfo(parcel: Parcel): Promise<ParcelInfo> {
  const bounds = parcel.bounds;
  const params: Record<string, string> = {
    id: parcel.identifier,
    csv: "no",
    srid: "25832",
    minx: String(bounds.minx),
    miny: String(bounds.miny),
    maxx: String(bounds.maxx),
    maxy: String(bounds.maxy)
  };

  console.log(`[Thüringen] Requesting InfoLika parcel information: ${parcel.flurstueckskennzeichen}`);

  const html = await getText(urlWithParams(INFO_FKZ_URL, params), "parcel information");
  return parseParcelInfoHtml(html, parcel);
}

function parseParcelInfoHtml(html: string, parcel: Parcel): ParcelInfo {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map((match) => compactText(stripHtml(match[0])))
    .filter(Boolean);

  const header = rows.find((row) => /^Flurstück\s+/i.test(row)) || "";
  const headerMatch = header.match(/^Flurstück\s+(.+?),\s*Flur\s+(.+?),\s*Gemarkung\s+(.+?)\s*\(([^)]+)\)/i);
  const gemeinde = rows.find((row) => /Gemeinde\s+/i.test(row))?.replace(/^Gebietszugehörigkeit:\s*/i, "");
  const kreis = rows.find((row) => /^Kreis\s+/i.test(row));
  const lage = rows.find((row) => /^Lage:\s*/i.test(row))?.replace(/^Lage:\s*/i, "");

  return {
    address: lage || null,
    kreis: kreis || "",
    gemeinde: gemeinde || "",
    gemarkung: headerMatch ? `Gemarkung ${headerMatch[3]} (${headerMatch[4]})` : "",
    flur: headerMatch ? `Flur ${headerMatch[2]}` : "",
    kennzeichen: headerMatch ? `Flurstück ${headerMatch[1]}` : formattedFkz(parcel.flurstueckskennzeichen)
  };
}

function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function printExtent(coordinate: [number, number]): { minx: number; miny: number; maxx: number; maxy: number } {
  const widthMeters = PRINT_LAYOUT_SIZE.width / PRINT_DPI / INCHES_PER_METER * PRINT_SCALE;
  const heightMeters = PRINT_LAYOUT_SIZE.height / PRINT_DPI / INCHES_PER_METER * PRINT_SCALE;

  return {
    minx: coordinate[0] - widthMeters / 2,
    miny: coordinate[1] - heightMeters / 2,
    maxx: coordinate[0] + widthMeters / 2,
    maxy: coordinate[1] + heightMeters / 2
  };
}

function createPrintPayload({
  coordinate,
  parcel,
  parcelInfo
}: {
  coordinate: [number, number];
  parcel: Parcel;
  parcelInfo: ParcelInfo;
}): Record<string, unknown> {
  const extent = printExtent(coordinate);
  const fkzHighlightId = parcel.identifier.includes("DETHL")
    ? parcel.identifier.slice(parcel.identifier.indexOf("DETHL"))
    : parcel.identifier;

  return {
    addparam: {
      bboxwest: `${oneDecimal(extent.minx)} (EPSG:25832)`,
      bboxsouth: `${oneDecimal(extent.miny)} (EPSG:25832)`,
      bboxeast: oneDecimal(extent.maxx),
      bboxnorth: oneDecimal(extent.maxy),
      kreis: parcelInfo.kreis,
      gemeinde: parcelInfo.gemeinde,
      gemarkung: parcelInfo.gemarkung,
      flur: parcelInfo.flur,
      kennzeichen: parcelInfo.kennzeichen,
      scalestext: String(PRINT_SCALE),
      sldtype: ["fkz"],
      FKZ: [fkzHighlightId]
    },
    addparamtype: "infolika",
    layers: [{
      baseURL: ALKIS_WMS_URL,
      customParams: {
        DPI: PRINT_DPI,
        TRANSPARENT: "true"
      },
      format: "image/png",
      layers: ["TH-ALKIS_infolika"],
      opacity: 0,
      styles: [""],
      title: "Bundesland",
      type: "WMS"
    }],
    layout: PRINT_LAYOUT,
    outputFilename: "InfoLika_Ausgabe_",
    outputFormat: "pdf",
    pages: [{
      center: coordinate,
      dpi: String(PRINT_DPI),
      geodetic: true,
      mapTitle: "InfoLika Ausgabe",
      scale: String(PRINT_SCALE),
      scaleText: `1 : ${PRINT_SCALE}`
    }],
    srs: "EPSG:25832"
  };
}

async function createOfficialPdf({
  coordinate,
  parcel,
  parcelInfo
}: {
  coordinate: [number, number];
  parcel: Parcel;
  parcelInfo: ParcelInfo;
}): Promise<string> {
  const payload = createPrintPayload({ coordinate, parcel, parcelInfo });

  console.log(`[Thüringen] Creating official InfoLika PDF`, {
    layout: payload.layout,
    flurstueckskennzeichen: parcel.flurstueckskennzeichen
  });

  const responseText = await postText(PRINT_CREATE_URL, JSON.stringify(payload), "official PDF generation");
  let responseJson: { getURL?: string };

  try {
    responseJson = JSON.parse(responseText);
  } catch (error) {
    throw new FlurkarteError("PDF_GENERATION_FAILED", "The print service did not return valid JSON.", {
      response: responseText.slice(0, 500),
      cause: (error as Error).message
    });
  }

  if (!responseJson.getURL) {
    throw new FlurkarteError("PDF_GENERATION_FAILED", "The print service did not return a PDF URL.", {
      response: responseJson
    });
  }

  return responseJson.getURL;
}

function createPreviewMapUrl([x, y]: [number, number]): string {
  const widthMeters = 220;
  const heightMeters = 160;
  const url = new URL(ALKIS_WMS_URL);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "TH-ALKIS_infolika",
    STYLES: "",
    CRS: "EPSG:25832",
    BBOX: [
      x - widthMeters / 2,
      y - heightMeters / 2,
      x + widthMeters / 2,
      y + heightMeters / 2
    ].map((value) => String(Math.round(value * 1000) / 1000)).join(","),
    WIDTH: "900",
    HEIGHT: "620",
    FORMAT: "image/png",
    TRANSPARENT: "false",
    DPI: String(PRINT_DPI)
  };

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

/**
 * Thüringen Flurkarte Adapter
 * Implements the FlurkarteAdapter interface for Thüringen state
 */
export const thueringenAdapter: FlurkarteAdapter = {
  bundesland: 'Thüringen',

  canHandle(input: FlurkarteInput): boolean {
    // Handle if bundesland is explicitly set to Thüringen
    if (input.bundesland) {
      const bl = input.bundesland.toLowerCase();
      return bl === 'thüringen' || bl === 'thueringen' || bl === 'thuringia';
    }
    // If no bundesland specified, try to infer from address
    if (input.address) {
      const addr = input.address.toLowerCase();
      // Check for Thüringen postal codes (99xxx, 07xxx, 04xxx, 98xxx, 37xxx, 36xxx)
      const postalCodeMatch = addr.match(/\b(99|07|04|98|37|36)\d{3}\b/);
      if (postalCodeMatch) {
        return true;
      }
      // Check for Thüringen city names
      const thueringenCities = [
        'erfurt', 'jena', 'weimar', 'gera', 'eisenach', 'suhl', 'ilmenau',
        'rudolstadt', 'saalfeld', 'altenburg', 'nordhausen', 'bad langensalza',
        'mühlhausen', 'heilbad heiligenstadt', 'schmalkalden', 'bad salzungen',
        'meiningen', 'gotha', 'nordhausen'
      ];
      if (thueringenCities.some(city => addr.includes(city))) {
        return true;
      }
    }
    // Fallback: handle if we have Thüringen-specific parcel IDs
    return !!(input.gemarkung || input.flur || input.flurstueck);
  },

  async getFlurkarte(input: FlurkarteInput): Promise<FlurkarteResult> {
    console.log(`[Thüringen Adapter] Processing request for: ${JSON.stringify(input)}`);

    if (!input.address) {
      throw new Error("The Thüringen adapter currently supports address-based search only.");
    }

    const extractedAt = new Date().toISOString();
    const parsedAddress = parseAddressInput(input.address);
    console.log(`[Thüringen] Parsed address: ${JSON.stringify(parsedAddress)}`);

    const town = await findTown(parsedAddress.town);
    const street = await findStreet(town.id, parsedAddress.street);
    const house = await findHouseNumber(street.id, parsedAddress.houseNumber);
    const parcel = await findParcelByCoordinate(house.coordinate);
    const parcelInfo = await fetchParcelInfo(parcel);

    let pdfUrl: string;
    try {
      pdfUrl = await createOfficialPdf({
        coordinate: house.coordinate,
        parcel,
        parcelInfo
      });
    } catch (error) {
      console.error("[Thüringen] Parcel found but PDF generation failed", {
        flurstueckskennzeichen: parcel.flurstueckskennzeichen,
        cause: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof FlurkarteError) {
        throw error;
      }

      throw new FlurkarteError("PDF_GENERATION_FAILED", "Parcel found, but the official PDF could not be generated.", {
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    const previewImageUrl = createPreviewMapUrl(house.coordinate);

    return {
      pdfUrl,
      previewImageUrl,
      pdfDownloadUrl: pdfUrl,
      flurstueckskennzeichen: parcel.flurstueckskennzeichen ?? 'Unknown',
      address: parcelInfo.address || formatAddress(parsedAddress),
      bundesland: BUNDESLAND,
      source: SOURCE,
      extractedAt,
      confidence: 'exact'
    };
  }
};
