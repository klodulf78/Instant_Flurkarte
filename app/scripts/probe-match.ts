/** Why does the exact lagebeztxt match fail? Dump nearby parcels.
 *   npx tsx scripts/probe-match.ts "Kurfürstenstraße 42, 53913 Swisttal"
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OGC = "https://ogc-api.nrw.de/lika/v1/collections/flurstueck/items";
const GEB = "https://ogc-api.nrw.de/lika/v1/collections/gebaeude_bauwerk/items";
const UA = "InstantFlurkarte-Probe/0.1";

function norm(v: string): string {
  return v.toLowerCase().replace(/ß/g, "ss").replace(/stra(ss|ß)e/g, "str")
    .replace(/\bstr\.?\b/g, "str").replace(/\s+/g, " ")
    .replace(/(\d+)\s+([a-z])\b/g, "$1$2").trim();
}
function pir(pt: number[], ring: number[][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!, xj = ring[j]![0]!, yj = ring[j]![1]!;
    if (yi > pt[1]! !== yj > pt[1]! && pt[0]! < ((xj - xi) * (pt[1]! - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function ringsOf(co: any): number[][][] {
  const o: number[][][] = [];
  const isPos = (p: any) => Array.isArray(p) && typeof p[0] === "number";
  const w = (n: any) => { if (!Array.isArray(n)) return; if (n.length && isPos(n[0])) { o.push(n); return; } n.forEach(w); };
  w(co); return o;
}
const inside = (pt: number[], g: any) => ringsOf(g?.coordinates).some((r) => pir(pt, r));

async function main() {
  const address = process.argv[2] ?? "Kurfürstenstraße 42, 53913 Swisttal";
  const key = norm(address.split(",")[0]!);
  console.log(`requested key: "${key}"`);

  const g = await fetch(`${NOMINATIM}?${new URLSearchParams({ q: address, format: "json", limit: "1", countrycodes: "de", addressdetails: "1" })}`, { headers: { "User-Agent": UA } });
  const hit = ((await g.json()) as any[])[0];
  const lon = Number(hit.lon), lat = Number(hit.lat);
  console.log(`geocode: ${lat},${lon} class=${hit.class} type=${hit.type} hnr=${hit.address?.house_number}`);

  for (const d of [0.0004, 0.001]) {
    const r = await fetch(`${OGC}?${new URLSearchParams({ bbox: [lon - d, lat - d, lon + d, lat + d].join(","), limit: "200", f: "json", profile: "rfc7946" })}`, { headers: { "User-Agent": UA } });
    const fs = ((await r.json()) as any).features ?? [];
    console.log(`\n--- delta=${d} (${fs.length} parcels) ---`);
    const rows = fs.map((f: any) => {
      const p = f.properties;
      const lk = p.lagebeztxt ? norm(p.lagebeztxt) : "";
      return { flur: p.flur, fst: p.flstnrzae, lage: p.lagebeztxt ?? "", lk, in: inside([lon, lat], f.geometry), match: lk === key };
    });
    const match = rows.find((r: any) => r.match);
    const conts = rows.filter((r: any) => r.in);
    console.log("  exact lagebeztxt match: " + (match ? `Flur ${match.flur} Flst ${match.fst} "${match.lage}"` : "—"));
    console.log("  containing parcel(s):   " + (conts.length ? conts.map((c: any) => `Flur ${c.flur} Flst ${c.fst} "${c.lage}"`).join(" ; ") : "—"));
    const nums = rows.filter((r: any) => /kurfürstenstr \d/.test(r.lk)).map((r: any) => Number(r.lk.match(/(\d+)/)?.[1])).filter((n: number) => Number.isFinite(n)).sort((a: number, b: number) => a - b);
    console.log("  Hausnummern (Kurfürstenstr): " + nums.join(", "));
  }

  // Try the building collection too (addresses live on buildings)
  const d = 0.0015;
  const gb = await fetch(`${GEB}?${new URLSearchParams({ bbox: [lon - d, lat - d, lon + d, lat + d].join(","), limit: "40", f: "json", profile: "rfc7946" })}`, { headers: { "User-Agent": UA } });
  const gj = (await gb.json()) as any;
  console.log(`\n--- gebaeude_bauwerk (${(gj.features ?? []).length}) ---`);
  console.log("  props of first: " + JSON.stringify((gj.features ?? [])[0]?.properties ?? {}));
  console.log("  with 'kurf'/'42': " + (gj.features ?? []).map((f: any) => JSON.stringify(f.properties)).filter((s: string) => /kurf|"42"|: ?"42/i.test(s)).slice(0, 5).join("\n    "));
}
main().catch((e) => { console.error(e); process.exit(1); });
