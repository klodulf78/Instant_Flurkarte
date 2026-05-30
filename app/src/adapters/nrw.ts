import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type {
  FlurkarteAdapter,
  FlurkarteInput,
  FlurkarteResult,
} from "../shared/contract.js";

const WMS_GET_MAP_URL =
  "https://www.wms.nrw.de/geobasis/wms_nw_alkis?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=adv_alkis_flurstuecke,adv_alkis_gebaeude,adv_alkis_tatsaechliche_nutzung&CRS=EPSG:25832&BBOX=356360,5645292.5,356734.2,5645646.3&WIDTH=1057&HEIGHT=1000&FORMAT=image/png&STYLES=";

const SOURCE = "Geobasis NRW (ALKIS WMS)";
const PLACEHOLDER_ADDRESS = "Domkloster 4, 50667 Koeln";
const PLACEHOLDER_FLURSTUECKSKENNZEICHEN = "NRW-M1-KOELN-BBOX";

async function fetchWmsPng(): Promise<Uint8Array> {
  const response = await fetch(WMS_GET_MAP_URL, {
    headers: { Accept: "image/png" },
  });

  if (!response.ok) {
    throw new Error(
      `ALKIS WMS GetMap failed: ${response.status} ${response.statusText}`,
    );
  }

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

async function composePdf(
  pngBytes: Uint8Array,
  result: Omit<FlurkarteResult, "pdfUrl">,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Instant Flurkarte M1");
  pdfDoc.setAuthor("Instant Flurkarte");
  pdfDoc.setSubject("Hardcoded NRW ALKIS WMS proof PDF");
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

function normalizeBundesland(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
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
    const extractedAt = new Date().toISOString();
    const resultWithoutPdf = {
      flurstueckskennzeichen: PLACEHOLDER_FLURSTUECKSKENNZEICHEN,
      address: input.address?.trim() || PLACEHOLDER_ADDRESS,
      bundesland: "NRW",
      source: SOURCE,
      extractedAt,
    };

    const pngBytes = await fetchWmsPng();
    const pdfBytes = await composePdf(pngBytes, resultWithoutPdf);

    return {
      ...resultWithoutPdf,
      pdfUrl: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString(
        "base64",
      )}`,
    };
  },
};
