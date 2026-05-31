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

export class FlurkarteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FlurkarteError";
    this.code = code;
    this.details = details;
  }
}

export async function get_flurkarte(input, options = {}) {
  return getFlurkarte(input, options);
}

export async function getFlurkarte(input, options = {}) {
  const resolved = await resolveFlurkarte(input, options);
  return resolved.result;
}

export async function getFlurkarteDemo(input, options = {}) {
  const resolved = await resolveFlurkarte(input, options);
  const { house, parcel, parcelInfo } = resolved.details;

  return {
    ...resolved.result,
    officialDocumentStatus: "PDF ready",
    previewMapUrl: createPreviewMapUrl(house.coordinate),
    trustBadge: "Official State Document",
    poweredBy: "Powered by Thüringen Geoportal",
    parcel: {
      gemarkung: parcelInfo.gemarkung,
      flur: parcelInfo.flur,
      kennzeichen: parcelInfo.kennzeichen,
      identifier: parcel.identifier,
      bounds: parcel.bounds
    },
    workflow: [
      { label: "Searching address", status: "complete" },
      { label: "Resolving parcel", status: "complete" },
      { label: "Retrieving official document", status: "complete" },
      { label: "PDF ready", status: "complete" }
    ]
  };
}

async function resolveFlurkarte(input, options = {}) {
  const logger = options.logger ?? console;
  const extractedAt = new Date().toISOString();

  if (!input || typeof input !== "object") {
    throw new FlurkarteError("INVALID_INPUT", "get_flurkarte expects an input object.");
  }

  if (input.bundesland && normalize(input.bundesland) !== normalize(BUNDESLAND)) {
    throw new FlurkarteError(
      "UNSUPPORTED_BUNDESLAND",
      `This prototype only supports ${BUNDESLAND}.`,
      { bundesland: input.bundesland }
    );
  }

  if (!input.address) {
    throw new FlurkarteError(
      "UNSUPPORTED_SEARCH",
      "The Thüringen prototype currently supports address-based search only.",
      { expected: "address" }
    );
  }

  const parsedAddress = parseAddressInput(input.address);
  logInfo(logger, "Searching Thüringen address", parsedAddress);

  const town = await findTown(parsedAddress.town, logger);
  const street = await findStreet(town.id, parsedAddress.street, logger);
  const house = await findHouseNumber(street.id, parsedAddress.houseNumber, logger);
  const parcel = await findParcelByCoordinate(house.coordinate, logger);
  const parcelInfo = await fetchParcelInfo(parcel, logger);

  let pdfUrl;
  try {
    pdfUrl = await createOfficialPdf({
      coordinate: house.coordinate,
      parcel,
      parcelInfo,
      logger
    });
  } catch (error) {
    logError(logger, "Parcel found but PDF generation failed", {
      flurstueckskennzeichen: parcel.flurstueckskennzeichen,
      cause: error.message
    });

    if (error instanceof FlurkarteError) {
      throw error;
    }

    throw new FlurkarteError("PDF_GENERATION_FAILED", "Parcel found, but the official PDF could not be generated.", {
      cause: error.message
    });
  }

  const result = {
    pdfUrl,
    flurstueckskennzeichen: parcel.flurstueckskennzeichen ?? null,
    address: parcelInfo.address || formatAddress(parsedAddress),
    bundesland: BUNDESLAND,
    source: SOURCE,
    extractedAt
  };

  return {
    result,
    details: {
      parsedAddress,
      town,
      street,
      house,
      parcel,
      parcelInfo
    }
  };
}

export function parseAddressInput(address) {
  const original = String(address ?? "");
  const normalizedInput = cleanAddressText(original);
  const postalCode = normalizedInput.match(/\b\d{5}\b/)?.[0] || null;
  const withoutPostalCode = cleanComponent(normalizedInput.replace(/\b\d{5}\b/g, " "));
  const parsed = parseCommaAddress(withoutPostalCode) || parseLooseAddress(withoutPostalCode);

  if (!parsed) {
    throwInvalidAddress(original);
  }

  const resolved = {
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
    throwInvalidAddress(original);
  }

  return resolved;
}

function parseCommaAddress(value) {
  const segments = value.split(",").map(cleanComponent).filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const houseSegmentIndex = segments.findIndex((segment) => extractHouseNumber(segment));
  if (houseSegmentIndex === -1) {
    return null;
  }

  const house = extractHouseNumber(segments[houseSegmentIndex]);
  const otherSegments = segments.filter((_, index) => index !== houseSegmentIndex);
  const town = cleanComponent(otherSegments.join(" "));
  const street = cleanComponent(house.before || house.after);

  return {
    street,
    houseNumber: house.houseNumber,
    town: town || cleanComponent(house.after)
  };
}

function parseLooseAddress(value) {
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

function extractHouseNumber(value) {
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

function splitTownAndStreet(value) {
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

function inferTownFromStreet(street) {
  return STREET_TOWN_HINTS.get(normalize(street)) || "";
}

function cleanAddressText(value) {
  return cleanComponent(String(value)
    .replace(/\s+-\s+[^,]+$/, "")
    .replace(/\b(deutschland|germany)\b/giu, " "));
}

function cleanComponent(value) {
  return String(value ?? "")
    .replace(/[;|]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHouseNumber(value) {
  return cleanComponent(value).replace(/\s*([-/])\s*/g, "$1").replace(/\s+/g, "");
}

function isUsefulAddressPart(value) {
  return /\p{Letter}/u.test(value);
}

function throwInvalidAddress(address) {
  throw new FlurkarteError("INVALID_ADDRESS", FRIENDLY_ADDRESS_ERROR, { address });
}

function formatAddress(address) {
  const postalTown = [address.postalCode, address.town].filter(Boolean).join(" ");
  return `${address.street} ${address.houseNumber}, ${postalTown}`.trim();
}

async function findTown(townName, logger) {
  logInfo(logger, "Requesting municipality candidates", { town: townName });
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

async function findStreet(townId, streetName, logger) {
  logInfo(logger, "Requesting street candidates", { townId, street: streetName });
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

async function findHouseNumber(streetId, houseNumber, logger) {
  logInfo(logger, "Requesting house-number candidates", { streetId, houseNumber });
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
      coordinate: parsePoint(textFromTag(member, "pos"))
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

  logWarn(logger, "Address not found: house number did not match any result", {
    requested: houseNumber,
    available: houses.slice(0, 20).map((house) => house.name)
  });
  throw new FlurkarteError("ADDRESS_NOT_FOUND", "Address not found: house number did not match any InfoLika result.", {
    requested: houseNumber
  });
}

async function findParcelByCoordinate(coordinate, logger) {
  for (const epsilon of [0.001, 1]) {
    const [x, y] = coordinate;
    const params = {
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

    logInfo(logger, "Requesting parcel by address coordinate", { coordinate, epsilon });
    const xml = await getText(urlWithParams(PARCEL_WFS_URL, params), "parcel lookup");
    const members = xmlMembers(xml);

    if (members.length === 0) {
      continue;
    }

    if (members.length > 1) {
      logWarn(logger, "Multiple parcels matched the coordinate; using the first result", {
        count: members.length
      });
    }

    const member = members[0];
    const parcel = {
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

    logInfo(logger, "Parcel found", {
      flurstueckskennzeichen: parcel.flurstueckskennzeichen,
      identifier: parcel.identifier
    });
    return parcel;
  }

  throw new FlurkarteError("ADDRESS_NOT_FOUND", "Address found, but no parcel matched the address coordinate.");
}

async function fetchParcelInfo(parcel, logger) {
  const bounds = parcel.bounds;
  const params = {
    id: parcel.identifier,
    csv: "no",
    srid: "25832",
    minx: String(bounds.minx),
    miny: String(bounds.miny),
    maxx: String(bounds.maxx),
    maxy: String(bounds.maxy)
  };

  logInfo(logger, "Requesting InfoLika parcel information", {
    flurstueckskennzeichen: parcel.flurstueckskennzeichen
  });

  const html = await getText(urlWithParams(INFO_FKZ_URL, params), "parcel information");
  return parseParcelInfoHtml(html, parcel);
}

function parseParcelInfoHtml(html, parcel) {
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

async function createOfficialPdf({ coordinate, parcel, parcelInfo, logger }) {
  const payload = createPrintPayload({ coordinate, parcel, parcelInfo });

  logInfo(logger, "Creating official InfoLika PDF", {
    layout: payload.layout,
    flurstueckskennzeichen: parcel.flurstueckskennzeichen
  });

  const responseText = await postText(PRINT_CREATE_URL, JSON.stringify(payload), "official PDF generation");
  let responseJson;

  try {
    responseJson = JSON.parse(responseText);
  } catch (error) {
    throw new FlurkarteError("PDF_GENERATION_FAILED", "The print service did not return valid JSON.", {
      response: responseText.slice(0, 500),
      cause: error.message
    });
  }

  if (!responseJson.getURL) {
    throw new FlurkarteError("PDF_GENERATION_FAILED", "The print service did not return a PDF URL.", {
      response: responseJson
    });
  }

  return responseJson.getURL;
}

function createPrintPayload({ coordinate, parcel, parcelInfo }) {
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

function createPreviewMapUrl([x, y]) {
  const widthMeters = 220;
  const heightMeters = 160;
  const url = new URL(ALKIS_WMS_URL);
  const params = {
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

  return String(url);
}

function printExtent([x, y]) {
  const widthMeters = PRINT_LAYOUT_SIZE.width / PRINT_DPI / INCHES_PER_METER * PRINT_SCALE;
  const heightMeters = PRINT_LAYOUT_SIZE.height / PRINT_DPI / INCHES_PER_METER * PRINT_SCALE;

  return {
    minx: x - widthMeters / 2,
    miny: y - heightMeters / 2,
    maxx: x + widthMeters / 2,
    maxy: y + heightMeters / 2
  };
}

function addressWfsParams(extra) {
  return {
    REQUEST: "GetFeature",
    SERVICE: "WFS",
    SRSNAME: "EPSG:25832",
    TYPENAMES: "tlvermgeo:GAZHKO_STREET",
    VERSION: "2.0.0",
    ...extra
  };
}

function chooseSingle(candidates, requested, label, notFoundCode) {
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

async function getText(url, label) {
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

async function postText(url, body, label) {
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

async function fetchWithRetry(url, options, errorInfo) {
  let lastError;

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
    cause: lastError?.cause?.message || lastError?.message || "unknown error"
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function urlWithParams(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url;
}

function xmlMembers(xml) {
  return [...xml.matchAll(/<(?:[A-Za-z0-9_.-]+:)?member\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?member>/gi)]
    .map((match) => match[1]);
}

function textFromTag(xml, localName) {
  const escaped = escapeRegExp(localName);
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escaped}>`,
    "i"
  );
  const match = xml.match(pattern);
  return match ? compactText(stripHtml(match[1])) : "";
}

function parsePoint(value) {
  const parts = value.split(/\s+/).map(Number).filter(Number.isFinite);
  return parts.length >= 2 ? [parts[0], parts[1]] : null;
}

function parseBounds(xml) {
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

function formattedFkz(rawFkz) {
  if (!rawFkz || rawFkz.length < 18) {
    return rawFkz || "";
  }

  return `Flurstück ${rawFkz.slice(9, 14).replace(/^0+/, "") || rawFkz.slice(9, 14)}`;
}

function stripHtml(value) {
  return decodeEntities(String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function decodeEntities(value) {
  const named = {
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

function compactText(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function normalizeHouseNumber(value) {
  return normalize(value).replace(/\s+/g, "");
}

function oneDecimal(value) {
  return String(Math.round(value * 10) / 10);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function logInfo(logger, message, details) {
  logger?.info?.(`[infolika] ${message}`, details ?? "");
}

function logWarn(logger, message, details) {
  logger?.warn?.(`[infolika] ${message}`, details ?? "");
}

function logError(logger, message, details) {
  logger?.error?.(`[infolika] ${message}`, details ?? "");
}
