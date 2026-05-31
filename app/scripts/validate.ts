/**
 * Fast Flurkarte validation harness — no portal, no PDF needed.
 *
 *   npx tsx scripts/validate.ts "Unnaer Straße 1, 59423 Unna" "Domkloster 4, 50667 Köln"
 *
 * For each address it independently checks:
 *   1. Geocode (Nominatim): does the address EXIST with the requested house
 *      number?  → catches hallucinated / non-existent addresses.
 *   2. Parcel (NRW OGC API): does the geocoded point fall INSIDE a parcel?
 *      → catches "nearest-parcel" fallbacks that produce a wrong Flurkarte.
 *   3. Dumps the RAW parcel properties so we can see the real Flur / Flurstück
 *      field names and values (debug the Flur/Flurstück distinction).
 *
 * Pass no args to run a built-in mix of real + deliberately fake addresses.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OGC = "https://ogc-api.nrw.de/lika/v1/collections/flurstueck/items";
const UA = "InstantFlurkarte-Validator/0.1 (hackathon)";

const DEFAULTS = [
  "Unnaer Straße 1, 59423 Unna",
  "Domkloster 4, 50667 Köln",
  "Unnaer Straße 99999, 59423 Unna", // fake house number → must be flagged
  "Diese Straße gibt es nicht 5, 12345 Irgendwo", // fake street → must be flagged
];

type Hit = {
  lat: string;
  lon: string;
  display_name?: string;
  class?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requestedHouseNumber(address: string): string | undefined {
  // first segment before the comma, last number token
  const seg = address.split(",")[0] ?? address;
  const m = seg.match(/(\d+[a-zA-Z]?)\s*$/);
  return m?.[1];
}

async function geocode(address: string): Promise<Hit[]> {
  const url = `${NOMINATIM}?${new URLSearchParams({
    q: address,
    format: "json",
    limit: "5",
    countrycodes: "de",
    addressdetails: "1",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return (await res.json()) as Hit[];
}

function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function toRings(coords: unknown): [number, number][][] {
  // normalise Polygon / MultiPolygon coordinate arrays to a list of rings
  const rings: [number, number][][] = [];
  const isPos = (p: unknown): p is [number, number] =>
    Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number";
  const collect = (node: unknown, depth: number): void => {
    if (!Array.isArray(node)) return;
    if (depth >= 4 && node.every(isPos)) {
      rings.push(node as [number, number][]);
      return;
    }
    if (node.length && isPos(node[0])) {
      rings.push(node as [number, number][]);
      return;
    }
    for (const child of node) collect(child, depth + 1);
  };
  collect(coords, 0);
  return rings;
}

function pointInFeature(pt: [number, number], geometry: any): boolean {
  return toRings(geometry?.coordinates).some((ring) => pointInRing(pt, ring));
}

function centroid(geometry: any): [number, number] {
  const rings = toRings(geometry?.coordinates);
  let sx = 0,
    sy = 0,
    n = 0;
  for (const ring of rings)
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
      n++;
    }
  return n ? [sx / n, sy / n] : [0, 0];
}

// rough metres between two lon/lat points (NRW latitudes)
function distM(a: [number, number], b: [number, number]): number {
  return Math.hypot((a[0] - b[0]) * 70_000, (a[1] - b[1]) * 111_000);
}

async function parcelsNear(lon: number, lat: number): Promise<any[]> {
  const d = 0.0012;
  const url = `${OGC}?${new URLSearchParams({
    bbox: [lon - d, lat - d, lon + d, lat + d].join(","),
    limit: "40",
    f: "json",
    profile: "rfc7946",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`OGC ${res.status}`);
  const json = (await res.json()) as { features?: any[] };
  return json.features ?? [];
}

function fkz(p: Record<string, any>): string {
  return [p.landschl, p.gemaschl, p.flur, p.flstnrzae]
    .filter(Boolean)
    .join("-");
}

async function validate(address: string): Promise<void> {
  console.log("\n▸ " + address);
  const reqHnr = requestedHouseNumber(address);

  let hits: Hit[];
  try {
    hits = await geocode(address);
  } catch (e) {
    console.log("  geocode:  FEHLER " + (e as Error).message);
    return;
  }
  const hit = hits[0];
  if (!hit) {
    console.log("  geocode:  ✗ keine Treffer");
    console.log("  VERDICT:  ⚠️  HALLUZINATIONSGEFAHR (Adresse nicht gefunden)");
    return;
  }

  const gotHnr = hit.address?.house_number;
  const hnrOk = !reqHnr || gotHnr === reqHnr;
  const lon = Number(hit.lon);
  const lat = Number(hit.lat);
  console.log(
    `  geocode:  ${lat.toFixed(5)}, ${lon.toFixed(5)} | class=${hit.class} type=${hit.type} | ` +
      `hausnr=${gotHnr ?? "—"} (angefragt ${reqHnr ?? "—"}) ${hnrOk ? "✓" : "✗"}`,
  );
  console.log(`            "${hit.display_name ?? ""}"`);

  let features: any[] = [];
  try {
    features = await parcelsNear(lon, lat);
  } catch (e) {
    console.log("  parcel:   OGC FEHLER " + (e as Error).message);
  }

  const containing = features.find((f) => pointInFeature([lon, lat], f.geometry));
  const nearest = features
    .map((f) => ({ f, d: distM([lon, lat], centroid(f.geometry)) }))
    .sort((a, b) => a.d - b.d)[0];

  if (containing) {
    const p = containing.properties as Record<string, any>;
    console.log(
      `  parcel:   ENTHÄLT Punkt ✓ | Gemarkung=${p.gemarkung}(${p.gemaschl}) ` +
        `Flur=${p.flur} Flurstück=${p.flstnrzae} | FKZ=${fkz(p)} | ${p.flaeche ?? "?"} m²`,
    );
    console.log("  raw:      " + JSON.stringify(p));
  } else if (nearest) {
    const p = nearest.f.properties as Record<string, any>;
    console.log(
      `  parcel:   KEIN enthaltendes Flurstück (nächstes ~${nearest.d.toFixed(0)} m) | ` +
        `nähestes: Flur=${p.flur} Flurstück=${p.flstnrzae} FKZ=${fkz(p)}`,
    );
  } else {
    console.log("  parcel:   keine Flurstücke im Umkreis");
  }

  const real = hnrOk && Boolean(containing);
  console.log(
    "  VERDICT:  " +
      (real
        ? "✅ ECHT"
        : "⚠️  HALLUZINATIONSGEFAHR — " +
          [!hnrOk && "Hausnummer nicht bestätigt", !containing && "Punkt in keinem Flurstück"]
            .filter(Boolean)
            .join(", ")),
  );
}

async function main(): Promise<void> {
  const addresses = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULTS;
  for (let i = 0; i < addresses.length; i++) {
    await validate(addresses[i]!);
    if (i < addresses.length - 1) await sleep(1100); // Nominatim etiquette
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
