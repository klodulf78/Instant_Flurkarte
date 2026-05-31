/**
 * Geocoding experiment: find a path that resolves a German house address to
 * the *containing* parcel (rooftop), instead of the street centroid.
 *   npx tsx scripts/geo-probe.ts
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OGC = "https://ogc-api.nrw.de/lika/v1/collections/flurstueck/items";
const UA = "InstantFlurkarte-Probe/0.1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pointInRing(pt: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!, xj = ring[j]![0]!, yj = ring[j]![1]!;
    if (yi > pt[1]! !== yj > pt[1]! && pt[0]! < ((xj - xi) * (pt[1]! - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function rings(coords: any): number[][][] {
  const out: number[][][] = [];
  const isPos = (p: any) => Array.isArray(p) && typeof p[0] === "number";
  const walk = (n: any) => {
    if (!Array.isArray(n)) return;
    if (n.length && isPos(n[0])) { out.push(n); return; }
    n.forEach(walk);
  };
  walk(coords);
  return out;
}
const inside = (pt: number[], g: any) => rings(g?.coordinates).some((r) => pointInRing(pt, r));

async function parcels(lon: number, lat: number): Promise<any[]> {
  const d = 0.0012;
  const url = `${OGC}?${new URLSearchParams({
    bbox: [lon - d, lat - d, lon + d, lat + d].join(","),
    limit: "40", f: "json", profile: "rfc7946",
  })}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  return ((await r.json()) as any).features ?? [];
}

async function probe(label: string, url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const hits = (await r.json()) as any[];
  const h = hits[0];
  console.log(`\n[${label}]`);
  if (!h) { console.log("  no hit"); return; }
  const lon = Number(h.lon), lat = Number(h.lat);
  console.log(`  ${lat.toFixed(6)},${lon.toFixed(6)} class=${h.class} type=${h.type} hnr=${h.address?.house_number ?? "—"}`);
  console.log(`  "${h.display_name}"`);
  const fs = await parcels(lon, lat);
  const cont = fs.find((f) => inside([lon, lat], f.geometry));
  if (cont) {
    const p = cont.properties;
    console.log(`  ✓ CONTAINING parcel: Flur=${p.flur} Flurstück=${p.flstnrzae} | "${p.lagebeztxt}"`);
  } else {
    console.log(`  ✗ no containing parcel among ${fs.length} nearby`);
  }
  // show lagebeztxt of nearby parcels (authoritative address strings)
  console.log("  nearby lagebeztxt: " +
    fs.slice(0, 8).map((f) => `${f.properties.flstnrzae}:"${f.properties.lagebeztxt ?? ""}"`).join(" | "));
  return { lon, lat };
}

async function main() {
  // 1) free-form (what the adapter does today)
  await probe("free q", `${NOMINATIM}?${new URLSearchParams({
    q: "Unnaer Straße 1, 59423 Unna", format: "json", limit: "5", countrycodes: "de", addressdetails: "1",
  })}`);
  await sleep(1100);
  // 2) STRUCTURED query (street incl. house number)
  await probe("structured", `${NOMINATIM}?${new URLSearchParams({
    street: "Unnaer Straße 1", city: "Unna", postalcode: "59423", country: "Germany",
    format: "json", limit: "5", addressdetails: "1",
  })}`);
  await sleep(1100);
  // 3) structured, house number variant
  await probe("structured#2", `${NOMINATIM}?${new URLSearchParams({
    street: "1 Unnaer Straße", city: "Unna", country: "Germany",
    format: "json", limit: "5", addressdetails: "1",
  })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
