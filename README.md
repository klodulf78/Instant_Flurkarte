# 🗺️ Instant Flurkarte

> Type any German address → get the official cadastral map (**Flurkarte**) in ~15 seconds.

## The problem

Every property financing in Germany needs a **Flurkarte** (cadastral / Liegenschaftskarte). Getting one means finding the right one of **16 separate state portals**, searching the address, locating the exact parcel, and exporting a PDF — **10–15 minutes for a single document.**

> *16 states. 16 portals. 16 ways to suffer.*

## What it does

**One address. One request.** Instant Flurkarte identifies the exact parcel and retrieves the **official, bank-ready PDF straight from the state's cadastral source** — in about **15 seconds**.

## Why it matters

Built around a real workflow at **Interhyp AG** (Germany's largest mortgage broker — ~1,500 employees, ~100,000 financings/year):

- ⚡ **60× faster** — 10–15 min → ~15 sec
- ⏱️ **~25,000 hours saved per year** (≈ **15 full-time employees**)
- 💶 **~€1.2M/year** in freed capacity
- 📄 …and that's for **one document**, on every single case

> And that's one company — across Germany's 1M+ property financings a year, it scales to a **quarter-million hours annually.**

## ▶️ Try it (live, no signup)

**Playground:** https://instant-flurkarte-82497296.alpic.live/try

Just type a **NRW address** into the chat — that's it. Try one of these:

| Address |
|---|
| `Schadowstraße 11, 40212 Düsseldorf` |
| `Markt 39, 52062 Aachen` |
| `Lindenstraße 20, 50674 Köln` |

You'll get the exact parcel identified, a live in-chat map preview, and the official PDF to open or download.

## 🗺️ Coverage & status

| State | Status |
|---|---|
| Nordrhein-Westfalen (NRW) | ✅ **Live** |
| Berlin | 🛠️ In progress (not yet in ChatGPT) |
| Thüringen | 🛠️ In progress (not yet in ChatGPT) |
| Remaining 13 states | 🔜 Planned |

## 🔭 Vision

Roll out all **16 Bundesländer** over the coming weeks — then pilot Instant Flurkarte **inside Interhyp AG via Copilot**, turning a hackathon prototype into a tool that's actually used in daily financing work.

## ⚙️ How it works

1. **Geocode** the address.
2. **Identify the exact parcel authoritatively** — match the official cadastral address (`lagebeztxt`) and verify the geocoded point lies *inside* the parcel. If it can't be matched cleanly, the result is **flagged, not guessed** (no hallucinated maps).
3. **Retrieve the official map** directly from the state source (NRW: TIM-online MapFish print service → authentic ALKIS Flurkarte PDF).
4. **Present it** as a live in-chat map preview **+** the official, bank-ready PDF.

The map scale is chosen **deterministically from the parcel size** (plus a fixed context margin), so the whole parcel, its neighbours, and the access to the street are always visible.

**Built with** [Skybridge](https://docs.skybridge.tech) (MCP + ChatGPT Apps), deployed on [Alpic](https://alpic.ai). **Data:** official state cadastral services (TIM-online / Geobasis NRW, ALKIS WMS, OGC API Features) under *Datenlizenz Deutschland Zero* (commercial use permitted).

## 🏗️ Architecture

```
Address Input
    └─► StateRouter (geocode → Bundesland detection)
            └─► NRWAdapter  (implements FlurkarteAdapter)
                    ├─► OGC API Features  → parcel match (lagebeztxt + point-in-polygon)
                    ├─► ALKIS WMS         → live map tile preview
                    └─► TIM-online MapFish → official PDF export
```

Each state is a single adapter implementing a shared contract:

```typescript
interface FlurkarteAdapter {
  resolveParcel(address: string): Promise<FlurkarteResult>;
}

interface FlurkarteResult {
  parcelId: string;
  mapPreviewUrl: string;
  pdfUrl: string;
  flagged: boolean; // true if match confidence is low
}
```

Adding a new Bundesland = one file implementing `FlurkarteAdapter`. The MCP tool routes an address to the matching state adapter, resolves the parcel, and returns the official document.

## 🛠️ Stack

| Layer | Technology |
|---|---|
| MCP framework | [Skybridge](https://docs.skybridge.tech) |
| ChatGPT integration | ChatGPT Apps SDK (MCP over SSE) |
| Hosting | [Alpic](https://alpic.ai) |
| Runtime | Node.js 24+ |
| Parcel data | OGC API Features (WFS3) — NRW: [Geobasis NRW](https://www.geobasis.nrw.de) |
| Map tiles | ALKIS WMS |
| PDF export | TIM-online MapFish print service |
| Data license | [Datenlizenz Deutschland – Zero (dl-de/zero-2-0)](https://www.govdata.de/dl-de/zero-2-0) — commercial use permitted |

## 🧑‍💻 Local development

Prerequisites: **Node.js 24+**

```bash
cd app
npm install
npm run dev          # MCP at localhost:3000/mcp, DevTools at /
npm run validate -- "Massener Kirchweg 33, 59427 Unna"   # fast address check, no portal needed
npm run build
npm run deploy       # deploy to Alpic
```

## 👥 Team

Built at **Berlin Hack Night, May 2026** — Karl (Interhyp), Sasha, Dokeun.
