# NRW Portal Extraction Brief — Instant Flurkarte (for Codex)

> **Approach: DETERMINISTIC.** We do NOT generate/compose a PDF ourselves.
> We drive the official **TIM-online MapFish Print** service server-side and
> return the **portal's own PDF** — guaranteed bank-conform. Verified live
> 2026-05-30 end-to-end with `curl` (no browser, no cookies, no auth).

## The whole flow (3 HTTP calls, all on `https://www.tim-online.nrw.de`)
1. **POST** `/mapfish-print/print/timonline_templates/report.pdf`
   - `Content-Type: application/json`, body = the print **spec** (see below).
   - (The portal sends it form-encoded as `spec=<urlencoded JSON>`; raw JSON body
     also works and is simpler for us.)
   - Response JSON: `{ "ref": "...", "statusURL": "...", "downloadURL": "..." }`
2. **GET** `/mapfish-print/print/status/{ref}.json` — poll (~1.5 s) until
   `{"done":true,"status":"finished"}`. On failure: `"status":"error"` + `"error"` msg.
3. **GET** `/mapfish-print/print/report/{ref}` — returns `application/pdf` (the Flurkarte).

`{ref}` looks like `65d5f584-...@f8585394-...`. Always build URLs from the
`statusURL`/`downloadURL` returned in step 1 (don't hardcode the app id).

## The print spec (PROVEN minimal version)
See `docs/research/mapfish-print-spec.proven.json` — it generated a valid 2-page
official Flurkarte. Shape:
```jsonc
{
  "layout": "A4 portrait nc no",          // portal's choice; many layouts exist (see capabilities)
  "outputFormat": "pdf",
  "attributes": {
    "title": "Instant Flurkarte",
    "comment": "",
    "scale": "1:1000",                      // string, shown in header
    "datasource": [{ "table": {             // REQUIRED for this layout (attribution table)
      "columns": ["url","layer","fees","accessConstraints"],
      "data": [["https://www.wms.nrw.de/geobasis/wms_nw_alkis","ALKIS",
                "Datenlizenz Deutschland Zero","Datenlizenz Deutschland Zero"]] }}],
    "map": {
      "projection": "EPSG:25832",
      "dpi": 127,                           // portal default
      "rotation": 0,
      "bbox": [minE, minN, maxE, maxN],     // OR use "center":[E,N] + "scale":1000 (MapFish derives extent)
      "layers": [ /* drawn top→bottom; first = on top */ ]
    }
  }
}
```
Missing a required attribute → status returns `error: "Missing required attribute: X"`. Add it.

## Layers
**Proven base layer (use this — simplest, no tile matrices, official ALKIS symbology):**
```json
{ "type": "wms",
  "baseURL": "https://www.wms.nrw.de/geobasis/wms_nw_alkis",
  "layers": ["adv_alkis_flurstuecke","adv_alkis_gebaeude","adv_alkis_tatsaechliche_nutzung"],
  "imageFormat": "image/png", "customParams": {"TRANSPARENT":"true"}, "version": "1.3.0" }
```
**What the portal actually uses** (for max fidelity later, optional): a GeoJSON
overlay (address label + parcel highlight, `renderAsSvg:true`, text symbolizer),
a DVG admin-boundary WMS (`wms_nw_dvg`, layer `nw_dvg_bld`), and the official
**WMTS** `https://www.wmts.nrw.de/geobasis/wmts_nw_alkis/.../{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png`
(layer `nw_alkis`, `requestEncoding:"REST"`, `matrixSet:"EPSG_25832_16"`).
→ Start with the WMS base. Add a GeoJSON layer (type `geojson`) on top to
**highlight the target parcel** (polygon symbolizer) and label the address.

## What the portal template gives us FOR FREE (don't rebuild)
Amtlicher Header (Bezirksregierung, GEObasis.nrw logo), **extraction date stamp**,
**"Keine amtliche Standardausgabe" (unbeglaubigt) note**, **north arrow**,
**scale bar**, parcel numbers, boundaries, buildings, street names. ✅ covers
most of `bank-requirements.md` out of the box.

## Resolve input → map extent (reuse verified OGC facts in `nrw-build-brief.md`)
- Address OR (gemarkung+flur+flurstueck) → query OGC API `flurstueck` →
  parcel geometry **in EPSG:25832** (`crs=http://www.opengis.net/def/crs/EPSG/0/25832`).
- Compute the parcel centroid + bounding box. **Hard rule (bank):** the printed
  extent must contain the **complete parcel** + its **Zuwegung to a public street**
  + neighboring parcels. Pick a scale (1:500–1:1000) and either pass `center`+`scale`
  (let MapFish size the frame) or a `bbox` sized to the A4 map-frame aspect (~0.82 w:h).
- Build `flurstueckskennzeichen` from land+gemaschl+flur+flstnrzae.

## Pipeline (`nrwAdapter.getFlurkarte`)
1. Resolve parcel (OGC API) → geometry + Flurstückskennzeichen (+ neighbors).
2. Compute center/scale (or bbox) honoring the Zuwegung rule.
3. Build the spec (title = address, scale string, datasource, map with WMS ALKIS
   base + GeoJSON highlight of the target parcel).
4. POST → poll status → GET the PDF bytes.
5. Return `FlurkarteResult` (pdfUrl, flurstueckskennzeichen, address, bundesland:"NRW",
   source:"TIM-online / Geobasis NRW", extractedAt). Host the PDF (Skybridge
   static/temp) or return a `data:` URL for now.

## Constraints / etiquette
- Public service — **be gentle**: cache results, don't hammer, sane timeouts +
  one retry. Poll status no faster than ~1 s.
- License **Datenlizenz Deutschland Zero** → commercial use OK.
- Keep the M1 WMS-compose adapter as a **fallback** if the portal is unreachable.
- Keep everything behind `nrwAdapter` (shared contract). Node 24. Only `app/`.
