# Bank Requirements — Flurkarte (property financing)

> Reference for the team **and** the AI coding assistant (Codex / Claude).
> Goal: the document we return must satisfy what German banks expect for a
> *Beleihungswertermittlung* (lending-value assessment).

## Why banks need it
The Flurkarte / Liegenschaftskarte lets the bank verify the property's
location, boundaries, shape and surroundings — input for the lending value.

## What the returned document MUST show

### Core map content — mandatory on EVERY Flurkarte (Interhyp practice)
- [ ] **Zuwegung** — the access route connecting the parcel to a **public
      street** must be visible (proves the property is accessible). The map
      extent must be wide enough to show it.
- [ ] **Complete target parcel** — the whole Flurstück, not cut off, **with
      Flur + Flurstücksnummer**.
- [ ] **Address + house number** of the property.
- [ ] **All surrounding parcels** (Nachbarflurstücke) with their numbers.
- [ ] Parcel boundaries (Grenzverlauf) and Gemarkung.

### Header frame (border around the map)
Most portal PDFs let you draw a border whose header carries:
- [ ] Bundesland (state)
- [ ] Address
- [ ] Scale (Maßstab, ~1:500–1:1000) + north arrow
- [ ] Source + extraction date

## Acceptance rules (important)
- **Non-certified (unbeglaubigt) is sufficient** for the bank's valuation.
  The sealed/official copy is only needed later at the notary / Grundbuch.
  → Our extracted portal PDF is fine.
- **Recency:** must not be older than ~6 months → always stamp the extraction date.
- Banks usually want a package: **Flurkarte + Grundbuchauszug + Lageplan**.
  We deliver the Flurkarte/Lageplan part.

## Out of scope (do NOT promise)
- Officially sealed extract (amtlich beglaubigt) — legal/liability risk.
- Grundbuchauszug — separate document, not from the cadastre.

## Sources
Bank document checklists: immobilienfinanzierung.de, drklein.de, check24,
baufi-nord.de (see project research notes).
