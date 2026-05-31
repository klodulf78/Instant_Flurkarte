import axios from 'axios';
import proj4 from 'proj4';
import { DOMParser } from '@xmldom/xmldom';
import type {
  FlurkarteAdapter,
  FlurkarteInput,
  FlurkarteResult,
} from '../shared/contract.js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';


// Coordinate system definition (WGS84 lat/lon <-> Berlin official EPSG:25833 UTM meters)
const WGS84 = 'EPSG:4326';
const BERLIN_UTM = '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

interface NominatimResponse {
  lat: string;
  lon: string;
  display_name: string;
  [key: string]: any; 
}

interface ParcelQueryResult {
  flurstueckskennzeichen: string | null;
  confidence: 'exact' | 'containing' | 'approximate';
  warning?: string;
}

// Helper functions (not part of the adapter interface)
function buildAddressFromIds(input: FlurkarteInput): string | null {
  if (!input.gemarkung && !input.flur && !input.flurstueck) {
    return null;
  }
  const parts = [];
  if (input.gemarkung) parts.push(`Gemarkung: ${input.gemarkung}`);
  if (input.flur) parts.push(`Flur: ${input.flur}`);
  if (input.flurstueck) parts.push(`Flurstück: ${input.flurstueck}`);
  return parts.join(', ');
}

async function queryFlurstueckByPoint(utmX: number, utmY: number): Promise<ParcelQueryResult> {
  console.log(`[WFS Query] Querying parcel at UTM coordinates: X=${utmX.toFixed(2)}, Y=${utmY.toFixed(2)}`);
  
  const wfsUrl = 'https://gdi.berlin.de/services/wfs/alkis_flurstuecke';
  
  // Use tight 90m bbox to avoid dense-area truncation
  const bboxRadius = 45; // 90m total diameter
  const minX = (utmX - bboxRadius).toFixed(2);
  const minY = (utmY - bboxRadius).toFixed(2);
  const maxX = (utmX + bboxRadius).toFixed(2);
  const maxY = (utmY + bboxRadius).toFixed(2);
  const bbox = `${minX},${minY},${maxX},${maxY},urn:ogc:def:crs:EPSG::25833`;
  
  const params = {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    typeNames: 'alkis_flurstuecke:flurstuecke',
    BBOX: bbox,
    COUNT: '200' // Limit to avoid truncation in dense areas
  };
  
  try {
    const response = await axios.get(wfsUrl, {
      params: params,
      timeout: 15000,
      headers: { 
        'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
      }
    });
    
    console.log(`[WFS Query] Response received, parsing features...`);
    
    // Parse XML response
    const xmlString = Buffer.from(response.data).toString('utf-8');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    const members = xmlDoc.getElementsByTagName('wfs:member');
    if (members.length === 0) {
      console.log(`[WFS Query] No parcels found in bbox`);
      return {
        flurstueckskennzeichen: null,
        confidence: 'approximate',
        warning: 'No parcels found in the area'
      };
    }
    
    // Find the parcel that contains the point (point-in-polygon)
    let containingParcel = null;
    let nearestParcel = null;
    let minDistance = Infinity;
    
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const fskoElement = member.getElementsByTagName('alkis_flurstuecke:fsko')[0];
      const geomElement = member.getElementsByTagName('alkis_flurstuecke:geom')[0];
      
      if (!fskoElement || !geomElement) continue;
      
      const fsko = fskoElement.textContent;
      
      // Extract polygon coordinates from GML
      const posListElement = geomElement.getElementsByTagName('gml:posList')[0];
      if (!posListElement) continue;
      
      const posListText = posListElement.textContent;
      if (!posListText) continue;
      
      const coords = posListText.trim().split(/\s+/).map(Number);
      const vertices = [];
      for (let j = 0; j < coords.length; j += 2) {
        vertices.push({ x: coords[j], y: coords[j + 1] });
      }
      
      // Check if point is inside polygon (ray-casting algorithm)
      const isInside = isPointInPolygon(utmX, utmY, vertices);
      if (isInside) {
        containingParcel = fsko;
        break;
      }
      
      // Calculate distance to nearest vertex for fallback
      for (const vertex of vertices) {
        const dist = Math.sqrt(Math.pow(utmX - vertex.x, 2) + Math.pow(utmY - vertex.y, 2));
        if (dist < minDistance) {
          minDistance = dist;
          nearestParcel = fsko;
        }
      }
    }
    
    if (containingParcel) {
      console.log(`[WFS Query] Found containing parcel: ${containingParcel}`);
      return {
        flurstueckskennzeichen: containingParcel,
        confidence: 'containing'
      };
    } else if (nearestParcel) {
      console.log(`[WFS Query] No containing parcel, using nearest: ${nearestParcel} (distance: ${minDistance.toFixed(2)}m)`);
      return {
        flurstueckskennzeichen: nearestParcel,
        confidence: 'approximate',
        warning: 'Address could not be matched exactly — nearest parcel chosen, please verify'
      };
    } else {
      console.log(`[WFS Query] No parcels found`);
      return {
        flurstueckskennzeichen: null,
        confidence: 'approximate',
        warning: 'No parcels found in the area'
      };
    }
  } catch (error: any) {
    console.error('[WFS Query Error]', error.message);
    return {
      flurstueckskennzeichen: null,
      confidence: 'approximate',
      warning: `WFS query failed: ${error.message}` 
    };
  }
}

function isPointInPolygon(x: number, y: number, vertices: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

async function getBboxFromCenter(utmX: number, utmY: number, radius: number): Promise<string> {
  const minX = (utmX - radius).toFixed(2);
  const minY = (utmY - radius).toFixed(2);
  const maxX = (utmX + radius).toFixed(2);
  const maxY = (utmY + radius).toFixed(2);
  return `${minX},${minY},${maxX},${maxY}`;
}

async function getWmsPreviewUrl(bbox: string): Promise<string> {
  const wmsUrl = 'https://gdi.berlin.de/services/wms/alkis_flurstuecke';
  const params = {
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: 'flurstuecke',
    STYLES: '',
    CRS: 'EPSG:25833',
    BBOX: bbox,
    WIDTH: '1200',
    HEIGHT: '900',
    FORMAT: 'image/png',
    TRANSPARENT: 'FALSE'
  };

  const response = await axios({
    method: 'GET',
    url: wmsUrl,
    params: params,
    responseType: 'arraybuffer',
    timeout: 30000
  });

  const base64Image = Buffer.from(response.data, 'binary').toString('base64');
  return `data:image/png;base64,${base64Image}`;
}

async function generateFlurkartePdf(
  imageBase64: string,
  address: string,
  flurstueckskennzeichen: string,
  bbox: string
): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  
  // A4 landscape (842 x 595 points)
  const page = pdfDoc.addPage([842, 595]);
  const { width, height } = page.getSize();
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // ── Header ──────────────────────────────────────────
  const headerHeight = 60;
  page.drawRectangle({
    x: 0, y: height - headerHeight,
    width, height: headerHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
  });

  page.drawText(`Flurkarte_${address}`, {
    x: 16, y: height - 22,
    size: 13, font: fontBold,
    color: rgb(0, 0, 0),
  });

  const now = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  page.drawText(`Geoportal Berlin · Erstellt am ${now}`, {
    x: 16, y: height - 38,
    size: 8, font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // ── Metadata sidebar ────────────────────────────────
  const sidebarX = width - 180;
  const metaItems = [
    ['Adresse', address],
    ['Flurstück', flurstueckskennzeichen],
    ['Bundesland', 'Berlin'],
    ['Quelle', 'GDI Berlin ALKIS'],
  ];
  let metaY = height - headerHeight - 20;
  for (const [label, value] of metaItems) {
    page.drawText(label, { x: sidebarX, y: metaY, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(value ?? '—', { x: sidebarX, y: metaY - 10, size: 8, font: fontBold, color: rgb(0, 0, 0) });
    metaY -= 28;
  }

  // ── Map image ───────────────────────────────────────
  const imageData = imageBase64.split(',')[1] ?? imageBase64;
  const pngImage = await pdfDoc.embedPng(Buffer.from(imageData, 'base64'));
  
  const mapMargin = 16;
  const mapTop = height - headerHeight - mapMargin;
  const mapBottom = 28; // footer height
  const mapWidth = sidebarX - mapMargin * 2;
  const mapHeight = mapTop - mapBottom;

  page.drawImage(pngImage, {
    x: mapMargin,
    y: mapBottom,
    width: mapWidth,
    height: mapHeight,
  });

  // ── Scale bar (approximate) ──────────────────────────
  // bbox = "minX,minY,maxX,maxY" in meters → calculate actual ground width
  const [minX, , maxX] = bbox.split(',').map(Number);
  const groundWidthM = maxX - minX;
  const pixelsPerMeter = mapWidth / groundWidthM;
  const scaleBarM = 50; // 50m bar
  const scaleBarPx = scaleBarM * pixelsPerMeter;

  page.drawLine({
    start: { x: mapMargin, y: mapBottom - 8 },
    end:   { x: mapMargin + scaleBarPx, y: mapBottom - 8 },
    thickness: 2, color: rgb(0, 0, 0),
  });
  page.drawText(`0`, { x: mapMargin, y: mapBottom - 18, size: 7, font });
  page.drawText(`${scaleBarM}m`, { x: mapMargin + scaleBarPx - 8, y: mapBottom - 18, size: 7, font });

  // ── Footer ──────────────────────────────────────────
  page.drawText(
    'Datenlizenz Deutschland – Zero (dl-de/zero-2-0) · Geoportal Berlin · gdi.berlin.de · Keine amtliche Standardausgabe',
    { x: 16, y: 8, size: 6, font, color: rgb(0.5, 0.5, 0.5) }
  );

  const pdfBytes = await pdfDoc.save();
  const base64Pdf = Buffer.from(pdfBytes).toString('base64');
  return `data:application/pdf;base64,${base64Pdf}`;
}

/**
 * Berlin/Brandenburg Flurkarte Adapter
 * Implements the FlurkarteAdapter interface for Berlin and Brandenburg states
 */
export const berlinAdapter: FlurkarteAdapter = {
  bundesland: 'Berlin',

  canHandle(input: FlurkarteInput): boolean {
    // Handle if bundesland is explicitly set to Berlin or Brandenburg
    if (input.bundesland) {
      const bl = input.bundesland.toLowerCase();
      return bl === 'berlin' || bl === 'brandenburg' || bl === 'berlin/brandenburg';
    }
    // If no bundesland specified, try to infer from address
    if (input.address) {
      const addr = input.address.toLowerCase();
      return addr.includes('berlin') || addr.includes('brandenburg') || addr.includes('potsdam');
    }
    // Fallback: handle if we have Berlin-specific parcel IDs
    return !!(input.gemarkung || input.flur || input.flurstueck);
  },

  async getFlurkarte(input: FlurkarteInput): Promise<FlurkarteResult> {
    console.log(`[Berlin Adapter] Processing request for: ${JSON.stringify(input)}`);

    // Use address if provided, otherwise use parcel IDs
    const address = input.address || buildAddressFromIds(input);
    
    if (!address) {
      throw new Error('Either address or parcel IDs (gemarkung, flur, flurstueck) must be provided');
    }

    // Geocode address to get UTM coordinates
    const geocodeUrl = 'https://nominatim.openstreetmap.org/search';
    const geocodeResponse = await axios.get<NominatimResponse[]>(geocodeUrl, {
      params: {
        q: address,
        format: 'json',
        limit: 1
      },
      headers: { 
        'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
      },
      timeout: 10000
    });

    if (!geocodeResponse.data || geocodeResponse.data.length === 0) {
      throw new Error(`Address not found: ${address}`);
    }

    const location = geocodeResponse.data[0];
    const lat = parseFloat(location.lat);
    const lon = parseFloat(location.lon);
    
    // Convert to UTM coordinates
    const [utmX, utmY] = proj4(WGS84, BERLIN_UTM, [lon, lat]) as [number, number];
    console.log(`[Berlin Adapter] Geocoded to UTM: X=${utmX.toFixed(2)}, Y=${utmY.toFixed(2)}`);
    
    // Query WFS for parcel identification
    const parcelResult = await queryFlurstueckByPoint(utmX, utmY);
    
    // Fetch ALKIS WMS map image
    const radius = 90; // 90m radius for map extent
    const bbox = await getBboxFromCenter(utmX, utmY, radius);
    const previewImageUrl = await getWmsPreviewUrl(bbox);
    
    // Generate PDF (for now, we'll use the image as a data URL since PDF generation is complex)
    // In a full implementation, we would use pdf-lib like the NRW adapter
    // const pdfUrl = previewImageUrl; // Using image as placeholder for PDF
    const pdfUrl = await generateFlurkartePdf(
      previewImageUrl,
      address,
      parcelResult.flurstueckskennzeichen ?? 'Unbekannt',
      bbox
    );
    
    return {
      pdfUrl,
      previewImageUrl,
      flurstueckskennzeichen: parcelResult.flurstueckskennzeichen || 'Unknown',
      address,
      bundesland: 'Berlin',
      source: 'GDI Berlin ALKIS WMS/WFS',
      extractedAt: new Date().toISOString(),
      confidence: parcelResult.confidence,
      warning: parcelResult.warning
    };
  }
};
