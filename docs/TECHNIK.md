# Instant Flurkarte, technische Dokumentation

Stand: 31. Mai 2026. Bezieht sich auf den Stand von `main` (Merge `3cf3dd3`).

---

## Inhalt

1. [Die Idee](#1-die-idee)
2. [Was das Tool aus Nutzersicht macht](#2-was-das-tool-aus-nutzersicht-macht)
3. [Architektur](#3-architektur)
4. [Der Ablauf Schritt für Schritt](#4-der-ablauf-schritt-für-schritt)
5. [Flurstücksauflösung, das Herzstück](#5-flurstücksauflösung-das-herzstück)
6. [Maßstabsberechnung](#6-maßstabsberechnung)
7. [Der Druckauftrag an TIM-online](#7-der-druckauftrag-an-tim-online)
8. [Datenquellen im Detail](#8-datenquellen-im-detail)
9. [Die MCP-Schicht: was das Modell sieht](#9-die-mcp-schicht-was-das-modell-sieht)
10. [Betriebsverhalten: Timeouts, Retries, Cache, Fallback](#10-betriebsverhalten-timeouts-retries-cache-fallback)
11. [Testwerkzeuge](#11-testwerkzeuge)
12. [Gelernte Lektionen](#12-gelernte-lektionen)
13. [Ein neues Bundesland anbinden](#13-ein-neues-bundesland-anbinden)
14. [Grenzen und offene Punkte](#14-grenzen-und-offene-punkte)
15. [Anhang](#15-anhang)

---

## 1. Die Idee

### Was eine Flurkarte ist

Die Flurkarte, amtlich Liegenschaftskarte, ist der Kartenauszug aus dem Liegenschaftskataster. Sie zeigt, wie ein Grundstück geschnitten ist, wo die Gebäude stehen, wie die Nachbargrundstücke verlaufen und wie das Grundstück an die Straße angebunden ist. Für eine Immobilienfinanzierung ist sie Pflicht. Ohne sie weiß die Bank nicht, worüber sie eigentlich entscheidet.

Ein Grundstück wird im Kataster über drei Ebenen identifiziert:

| Ebene | Bedeutung | Beispiel |
|---|---|---|
| Gemarkung | Katasterbezirk, meist ein Ortsteil | Massen (051406) |
| Flur | Untergliederung der Gemarkung | 004 |
| Flurstück | das einzelne Grundstück | 1355, oder als Bruch 3119/11 |

Zusammengesetzt ergibt das das Flurstückskennzeichen, bei uns in der Form `Land-Gemarkung-Flur-Flurstück`, also `05-051406-004-1355`. Die `05` steht für Nordrhein-Westfalen.

Wichtig für das Verständnis: Die Hausnummer hat mit Flur und Flurstück nichts zu tun. Auf der Karte ist die große Zahl in der Fläche die Flurstücksnummer, die kleine Zahl am Gebäude die Hausnummer. Ein Flurstück kann mehrere Hausnummern tragen, etwa wenn ein Grundstück die Häuser 16 bis 22 umfasst.

### Das Problem

Deutschland hat kein zentrales Katasterportal. Jedes Bundesland betreibt sein eigenes. Sechzehn Portale, sechzehn Oberflächen, sechzehn Suchlogiken, sechzehn Exportwege. Wer eine Flurkarte braucht, muss das richtige Portal kennen, die Adresse dort finden, das passende Flurstück identifizieren, den Kartenausschnitt und den Maßstab von Hand einstellen und dann ein PDF erzeugen.

Das dauert 10 bis 15 Minuten. Pro Fall. Bei Interhyp mit rund 100.000 Finanzierungen im Jahr sind das etwa 25.000 Stunden, umgerechnet die Arbeitszeit von rund 15 Vollzeitkräften.

Der Aufwand entsteht nicht durch das Dokument selbst. Er entsteht durch die Suche danach.

### Die Lösung

Instant Flurkarte macht daraus eine einzige Frage im Chat. Der Nutzer tippt eine Adresse, das Tool bestimmt das Flurstück und holt die amtliche PDF direkt beim Land. Das dauert rund 15 Sekunden.

### Die zentrale Entscheidung: extrahieren statt erzeugen

Wir hätten die Karte selbst zeichnen können. Die Rohdaten sind offen, wir hätten Flurstücksgrenzen, Gebäude und Beschriftungen aus den Geodiensten holen und daraus ein eigenes PDF bauen können.

Das haben wir bewusst nicht gemacht. Eine selbst gezeichnete Karte ist eine Nachbildung. Sie sieht ähnlich aus, ist aber kein amtliches Dokument. Für eine Bank ist dieser Unterschied entscheidend.

Stattdessen steuern wir den amtlichen Druckdienst des Landes von außen an. Das Land erzeugt die PDF, mit seinem Layout, seinem Kopfbereich, seinem Nordpfeil, seinem Maßstabsbalken, seinem Hinweis auf die Datenquelle und seinem Stempel für das Ausgabedatum. Wir bekommen dieses Dokument unverändert zurück und reichen es weiter.

Damit ist das Ergebnis deterministisch. Gleiche Adresse, gleiches Flurstück, gleiches Dokument. Nichts wird von einem Sprachmodell generiert. Das Modell versteht nur die Frage und zeigt das Ergebnis an. Alles dazwischen ist normaler Code.

---

## 2. Was das Tool aus Nutzersicht macht

Der Nutzer schreibt in ChatGPT oder Copilot:

> Gib mir die Flurkarte für die Kurfürstenstraße 42, 53913 Swisttal

Das Modell erkennt, dass es dafür ein Werkzeug gibt, und ruft es mit der Adresse auf. Nach einigen Sekunden erscheint im Chat eine Karte mit:

- der Kartenvorschau des Ausschnitts
- der Adresse
- dem Flurstückskennzeichen, hier `05-054109-15-245`
- der Quelle und dem Zeitstempel
- einem Knopf, der die amtliche PDF öffnet

Wenn die Adresse nicht sauber zugeordnet werden konnte, steht zusätzlich ein gelber Warnhinweis in der Karte und im Antworttext des Modells. Die Karte kommt trotzdem, aber sie ist als ungesichert markiert.

---

## 3. Architektur

### Die vier Schichten

```
┌──────────────────────────────────────────────────────────┐
│  Oberfläche                                              │
│  ChatGPT oder Copilot. Der Nutzer stellt eine Frage.     │
└────────────────────────┬─────────────────────────────────┘
                         │ MCP (Model Context Protocol)
┌────────────────────────▼─────────────────────────────────┐
│  Instant Flurkarte (Skybridge-App auf Alpic)             │
│  src/server.ts     Tool-Definition, Ein- und Ausgabe     │
│  src/views/        React-Ansicht im Chat                 │
└────────────────────────┬─────────────────────────────────┘
                         │ FlurkarteAdapter (gemeinsamer Vertrag)
┌────────────────────────▼─────────────────────────────────┐
│  Adapter je Bundesland                                   │
│  src/adapters/nrw.ts     (live)                          │
│  Berlin, Thüringen        (in Arbeit)                    │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼─────────────────────────────────┐
│  Amtliche Landesdienste                                  │
│  OGC API Features  Flurstücksgeometrie und Attribute     │
│  ALKIS WMS         Kartenbild für die Vorschau           │
│  MapFish Print     amtliche PDF                          │
└──────────────────────────────────────────────────────────┘
```

### Der gemeinsame Vertrag

Alle Bundesländer teilen sich eine Schnittstelle. Das ist der Grund, warum ein neues Land angebunden werden kann, ohne dass am Rest etwas geändert wird.

`src/shared/contract.ts`:

```ts
export interface FlurkarteInput {
  address?: string;          // "Kurfürstenstraße 42, 53913 Swisttal"
  bundesland?: string;       // "NRW" | "Berlin" | ...
  gemarkung?: string;        // nur als Rückfallebene
  flur?: string;
  flurstueck?: string;
}

export interface FlurkarteResult {
  pdfUrl: string;                    // data:application/pdf;base64,...
  pdfDownloadUrl?: string;           // öffentliche https-URL der PDF
  previewImageUrl?: string;          // WMS-Bild für die Chat-Vorschau
  flurstueckskennzeichen: string;    // "05-054109-15-245"
  address: string;
  bundesland: string;
  source: string;                    // "TIM-online / Geobasis NRW"
  extractedAt: string;               // ISO 8601
  confidence?: "exact" | "containing" | "approximate";
  warning?: string;                  // gesetzt, wenn confidence unsicher ist
}

export interface FlurkarteAdapter {
  readonly bundesland: string;
  canHandle(input: FlurkarteInput): boolean;
  getFlurkarte(input: FlurkarteInput): Promise<FlurkarteResult>;
}
```

`selectAdapter()` nimmt die Eingabe und die Liste der Adapter und gibt den ersten zurück, der `canHandle` mit `true` beantwortet. Der NRW-Adapter antwortet mit `true`, wenn kein Bundesland angegeben ist oder wenn es `nrw` beziehungsweise `nordrhein-westfalen` lautet.

### Codeumfang

| Datei | Zeilen | Aufgabe |
|---|---:|---|
| `src/adapters/nrw.ts` | 1354 | die gesamte NRW-Logik |
| `src/server.ts` | 186 | MCP-Tools und Ausgabeformat |
| `src/views/get-flurkarte.tsx` | 122 | Chat-Ansicht |
| `src/shared/contract.ts` | 64 | gemeinsamer Vertrag |
| `scripts/*.ts` | 411 | Testwerkzeuge |

---

## 4. Der Ablauf Schritt für Schritt

Ein Aufruf von `get_flurkarte` mit einer Adresse durchläuft folgende Kette:

```
Adresse
  │
  ├─ 1. Cache prüfen (10 Minuten TTL) ────────► Treffer? fertig
  │
  ├─ 2. Geocoding (Nominatim)
  │      Adresse → lon/lat + Hausnummer + Objekttyp
  │
  ├─ 3. Flurstücke im Umkreis holen (OGC API)
  │      bbox ±0.0008° (~90 m), limit 200, CRS84
  │
  ├─ 4. Zielflurstück wählen (3 Stufen, siehe Kapitel 5)
  │      → Flurstück + confidence
  │
  ├─ 5. Flurstück in EPSG:25832 nachladen
  │      exakte Geometrie für Zentrum und Maßstab
  │
  ├─ 6. Zentrum, Bounding-Box und Maßstab berechnen
  │
  ├─ 7. Nachbarflurstücke im Druckausschnitt holen
  │      für die Beschriftung im Kartenbild
  │
  ├─ 8. MapFish-Spec bauen und Druckauftrag senden
  │      POST → Status pollen → PDF laden
  │
  └─ 9. Ergebnis zusammensetzen
         PDF + Download-URL + WMS-Vorschau + Metadaten + confidence
```

Schritt 5 sieht redundant aus, ist es aber nicht. Die Suche in Schritt 3 läuft in geographischen Koordinaten, weil der Geocoder lon/lat liefert. Für die Kartenberechnung brauchen wir metrische Koordinaten. Deshalb wird das gefundene Flurstück ein zweites Mal geholt, diesmal explizit in EPSG:25832.

---

## 5. Flurstücksauflösung, das Herzstück

Das ist der Teil, der über richtig und falsch entscheidet. Ein Geocoder liefert nur einen Punkt. Er sagt nicht, zu welchem Flurstück dieser Punkt gehört, und er liegt manchmal daneben.

Wir arbeiten deshalb mit drei Stufen und geben offen an, welche gegriffen hat.

### Stufe A: enthaltendes Flurstück

Wir prüfen mit einem Ray-Casting-Algorithmus, in welchem Flurstückspolygon der geocodierte Punkt liegt. Das ist das stärkste Signal, weil es die physische Wahrheit abbildet: Auf welchem Grundstück steht das Gebäude?

Zusätzlich prüfen wir, ob das Flurstück plausibel ist. Ausgeschlossen werden Splitterflächen unter 20 Quadratmetern und reine Verkehrsflächen, erkennbar am Attribut `tntxt` mit Werten wie Straßenverkehr, Bahnverkehr oder Weg, sofern keine Wohnbaufläche dabei ist.

### Stufe B: amtliche Lagebezeichnung

Jedes Flurstück trägt im Kataster das Attribut `lagebeztxt`, die amtliche Lagebezeichnung. Das ist genau die Adresse, die auf der Karte am Gebäude steht, zum Beispiel `Massener Kirchweg 33`.

Wenn die Lagebezeichnung des enthaltenden Flurstücks zur angefragten Adresse passt, ist das Ergebnis `exact`. Passt sie nicht, bleibt es bei `containing`.

Der Abgleich normalisiert beide Seiten, weil das Kataster anders schreibt als der Nutzer:

| Eingabe | normalisiert |
|---|---|
| `Lindenstraße 20` | `lindenstr 20` |
| `Lindenstr. 20` | `lindenstr 20` |
| `Massener Kirchweg 33 a` | `massener kirchweg 33a` |

Die Regeln: alles klein, `ß` zu `ss`, `straße` zu `str`, Abkürzungspunkte zu Leerzeichen, Mehrfachleerzeichen zusammenfassen, Hausnummernzusätze anhängen.

Mehrfachadressen werden behandelt. Ein Flurstück mit der Lagebezeichnung `Lindenstr. 16, 18, 20, 22` gilt als Treffer für Hausnummer 20. Dazu wird der Straßenteil verglichen und geprüft, ob die gesuchte Hausnummer in der Liste steht.

### Stufe C: nächstgelegenes Flurstück

Findet keine der ersten beiden Stufen etwas, nehmen wir das nächstgelegene plausible Flurstück und markieren das Ergebnis als `approximate`. Dazu kommt ein Warntext, der im Chat und in der Ansicht erscheint:

> Adresse konnte nicht eindeutig einem Flurstück zugeordnet werden, es wurde das nächstgelegene Flurstück gewählt. Bitte vor Verwendung prüfen.

Die Auswahl in dieser Stufe ist gewichtet. Grundlage ist die Entfernung zum geocodierten Punkt, davon werden Boni abgezogen für Wohnbaufläche, für eine Hausnummer in der Lagebezeichnung, für eine plausible Grundstücksgröße zwischen 100 und 3000 Quadratmetern. Splitterflächen bekommen einen Aufschlag.

### Warum die Reihenfolge wichtig ist

In einer früheren Fassung stand die Lagebezeichnung an erster Stelle. Das Ergebnis war ein Fehler: Bei `Lindenstraße 20, 50674 Köln` wurde ein anderes Flurstück derselben Straße gewählt, weil dessen Lagebezeichnung zuerst im Ergebnis stand. Seitdem gilt: Der Punkt entscheidet, die Lagebezeichnung bestätigt.

### Warum die Suchgröße wichtig ist

Ursprünglich lag der Suchradius bei 0,0015 Grad und das Limit bei 40 Flurstücken. In dicht bebauten Straßen liegen dort über hundert Flurstücke. Das richtige wurde abgeschnitten und die Auflösung fiel auf Stufe C zurück. Bei `Kurfürstenstraße 42, 53913 Swisttal` kam so Hausnummer 38 statt 42 heraus.

Jetzt gilt: Radius 0,0008 Grad, das sind etwa 90 Meter, und Limit 200. Damit ist das Flurstück in allen getesteten Fällen enthalten.

---

## 6. Maßstabsberechnung

Der Maßstab wird aus der Größe des Flurstücks berechnet. Nichts ist pro Adresse fest hinterlegt, das Ergebnis ist bei gleicher Eingabe immer gleich.

### Die Konstanten

```ts
const BANK_CONTEXT_MARGIN_M = 35;        // Rand rings um das Flurstück in Metern
const MAP_FRAME_WIDTH_AT_1000_M  = 198;  // Bodenbreite des Kartenfensters bei 1:1000
const MAP_FRAME_HEIGHT_AT_1000_M = 242;  // Bodenhöhe des Kartenfensters bei 1:1000
const SCALE_LADDER = [250, 500, 750, 1000, 1500, 2000, 2500];
```

Die 198 mal 242 kommen aus dem A4-Kartenfenster der TIM-online-Vorlage. Bei 1:1000 entspricht ein Millimeter auf dem Papier einem Meter im Gelände, das Fenster ist also 198 mal 242 Millimeter groß.

### Der Rechenweg

```ts
function chooseScaleForBbox(bbox) {
  const width  = bbox[2] - bbox[0];                  // Flurstücksbreite in Metern
  const height = bbox[3] - bbox[1];                  // Flurstückshöhe in Metern
  const neededWidth  = width  + BANK_CONTEXT_MARGIN_M * 2;
  const neededHeight = height + BANK_CONTEXT_MARGIN_M * 2;
  const requiredScale = Math.max(
    neededWidth  / (MAP_FRAME_WIDTH_AT_1000_M  / 1000),
    neededHeight / (MAP_FRAME_HEIGHT_AT_1000_M / 1000),
  );
  return SCALE_LADDER.find(s => s >= requiredScale) ?? 2500;
}
```

Im Klartext: Nimm die Größe des Flurstücks, leg 35 Meter Rand ringsum dazu, sieh nach, wie viel Fläche gezeigt werden muss, und wähle dann die kleinste Stufe der Leiter, in die das noch passt.

Der Rand von 35 Metern sorgt dafür, dass Nachbargrundstücke und die Anbindung an die Straße mit im Bild sind. Genau das braucht die Bank.

Die Leiter aus runden Maßstäben ist Absicht. Amtliche Karten arbeiten mit runden Werten, 1:684 würde niemand so drucken.

### Beispiele aus echten Tests

| Adresse | Flurstück | Maßstab |
|---|---|---|
| Massener Kirchweg 33, 59427 Unna | 1355, kleines Wohngrundstück | 1:500 |
| Kurfürstenstraße 42, 53913 Swisttal | 245 | 1:750 |
| Lindenstraße 20, 50674 Köln | 3119/11, umfasst Häuser 16 bis 22 | 1:750 |

### Zentrum des Kartenausschnitts

Das Zentrum ist der flächengewichtete Schwerpunkt des Flurstücks, berechnet über die Gaußsche Trapezformel, angewendet auf jeden Ring. Multipolygone und Löcher werden korrekt behandelt, weil die Teilflächen mit ihrem Vorzeichen in die Summe eingehen. Für die numerische Stabilität wird vorher der Mittelpunkt der Bounding-Box als lokaler Ursprung abgezogen, sonst rechnet man mit UTM-Koordinaten in Millionenhöhe und verliert Genauigkeit.

---

## 7. Der Druckauftrag an TIM-online

### Das Protokoll

TIM-online nutzt MapFish Print v3. Der Ablauf besteht aus drei HTTP-Aufrufen, alle ohne Browser, ohne Cookies, ohne Anmeldung:

```
1. POST https://www.tim-online.nrw.de/mapfish-print/print/timonline_templates/report.pdf
   Body: die Spec als JSON
   Antwort: { "ref": "...", "statusURL": "...", "downloadURL": "..." }

2. GET  {statusURL}      alle 1,2 Sekunden, maximal 30 Versuche
   Antwort: { "done": true, "status": "finished" }
   bei Fehler: { "status": "error", "error": "..." }

3. GET  {downloadURL}    liefert application/pdf
```

Die URLs aus Schritt 1 werden übernommen und nicht selbst zusammengebaut, weil die Referenz eine App-Kennung enthält.

### Die Spec

```jsonc
{
  "layout": "A4 portrait nc",          // mit Übersichtskarte
  "outputFormat": "pdf",
  "outputFilename": "Kurfuerstenstrasse_42_53913_Swisttal",
  "attributes": {
    "title": "Flurkarte_Kurfürstenstraße 42, 53913 Swisttal",
    "comment": "",
    "scale": "750",
    "datasource": [ { "table": {
      "columns": ["url", "layer", "fees", "accessConstraints"],
      "data": [[ "https://www.wms.nrw.de/geobasis/wms_nw_alkis", "ALKIS",
                 "Datenlizenz Deutschland Zero", "Datenlizenz Deutschland Zero" ]]
    } } ],
    "map": {
      "projection": "EPSG:25832",
      "dpi": 127,
      "rotation": 0,
      "center": [365123.4, 5615987.2],
      "scale": 750,
      "layers": [ /* Reihenfolge siehe unten */ ]
    },
    "overviewMap": {
      "projection": "EPSG:25832",
      "dpi": 127,
      "rotation": 0,
      "bbox": [288300, 5551800, 524700, 5842200],   // ganz NRW, fest
      "layers": [ { "type": "wms",
        "baseURL": "https://www.wms.nrw.de/geobasis/wms_nw_nrw_uebersicht",
        "layers": ["nw_nrw_uebersicht_5000_utm32"] } ]
    }
  }
}
```

Anmerkungen dazu:

- `layout` heißt `A4 portrait nc`, nicht `A4 portrait nc no`. Die Variante ohne `no` enthält die Übersichtskarte.
- `datasource` ist Pflicht. Fehlt sie, antwortet der Statusendpunkt mit `Missing required attribute`.
- `center` plus `scale` ist einfacher als eine Bounding-Box, weil MapFish das Fenster selbst passend aufzieht.
- Die Bounding-Box der Übersichtskarte ist fest und umfasst ganz Nordrhein-Westfalen.
- `dpi: 127` ist die Vorgabe des Portals.

### Die Ebenen und ihre Reihenfolge

Die Reihenfolge im Array ist entscheidend. MapFish zeichnet das erste Element zuoberst.

```ts
const layers = [
  targetLayer,      // GeoJSON: Markierung und Beschriftung des Zielflurstücks
  neighborLayer,    // GeoJSON: Nummern der Nachbarflurstücke
  ALKIS_WMS_LAYER,  // die amtliche Karte
];
```

Innerhalb des WMS-Layers gilt die umgekehrte Logik. Dort zeichnet der Dienst das letzte Element zuoberst:

```ts
layers: [
  "adv_alkis_tatsaechliche_nutzung",  // unten, deckende Nutzungsflächen
  "adv_alkis_flurstuecke",            // Mitte, Grenzen und Nummern
  "adv_alkis_gebaeude",               // oben, Gebäude
]
```

Das war ein echter Fehler in einer früheren Fassung. Mit der Nutzungsfläche zuoberst waren die Gebäude verdeckt, auf der Karte war nur das leere Flurstück zu sehen. Der Test war eindeutig: falsche Reihenfolge 29 Kilobyte Bilddaten, richtige Reihenfolge 143 Kilobyte.

### Die eigenen Ebenen

Wir legen zwei GeoJSON-Ebenen über die amtliche Karte.

Das Zielflurstück bekommt einen roten Rahmen mit 2,5 Punkt Stärke und eine leichte Füllung mit 12 Prozent Deckkraft. Die Beschriftung `Flur 15 · Flurstück 245` sitzt etwa einen Zentimeter unterhalb der Südkante des Flurstücks. Der Abstand wird aus dem Maßstab gerechnet, `scale / 100` ergibt einen Zentimeter Papierabstand in Metern im Gelände.

Warum unterhalb und nicht mittig? Weil TIM-online die Flurstücksnummer selbst in die Fläche zeichnet. Ein Label in der Mitte verdeckt genau die Zahl, um die es geht.

Die Nachbarflurstücke bekommen ihre Nummer als kleine kursive Beschriftung in 8 Punkt an ihrem Schwerpunkt.

---

## 8. Datenquellen im Detail

### Übersicht

| Dienst | Zweck | Endpunkt |
|---|---|---|
| Nominatim | Adresse zu Koordinate | `nominatim.openstreetmap.org/search` |
| OGC API Features | Flurstücksgeometrie und Attribute | `ogc-api.nrw.de/lika/v1/collections/flurstueck/items` |
| ALKIS WMS | Kartenbild für Vorschau und Druck | `www.wms.nrw.de/geobasis/wms_nw_alkis` |
| Übersichts-WMS | kleine Übersichtskarte in der PDF | `www.wms.nrw.de/geobasis/wms_nw_nrw_uebersicht` |
| MapFish Print | die amtliche PDF | `www.tim-online.nrw.de/mapfish-print/print/...` |

### Koordinatensysteme

NRW rechnet in EPSG:25832, das ist UTM Zone 32 auf ETRS89. Die Einheit ist Meter, deshalb funktionieren Breiten- und Höhenrechnungen direkt.

Die OGC API liefert standardmäßig CRS84, also Längen- und Breitengrad. Für metrische Ausgabe muss der Parameter gesetzt werden:

```
crs=http://www.opengis.net/def/crs/EPSG/0/25832
```

Berlin und Brandenburg liegen in Zone 33 und rechnen in EPSG:25833. Die gesamte Maßstabslogik gilt dort unverändert, weil auch das Meter sind.

### Wichtige Attribute eines Flurstücks

Ein Datensatz aus der OGC API sieht so aus:

```json
{
  "objid": "DENW12AL0000MlBxFL",
  "flurstid": "DENW12AL0000MlBx",
  "land": "Nordrhein-Westfalen",
  "landschl": "05",
  "gemarkung": "Massen",
  "gemaschl": "051406",
  "flur": "004",
  "flurschl": "051406004",
  "flstnrzae": "1355",
  "flaeche": 795,
  "lagebeztxt": "Massener Kirchweg 33",
  "tntxt": "Wohnbaufläche;795",
  "kreis": "Unna",
  "gemeinde": "Unna",
  "gebaeuderef": [ { "title": "Gebäude Massener Kirchweg 33", "href": "..." } ]
}
```

Für uns zählen vor allem:

| Attribut | Verwendung |
|---|---|
| `lagebeztxt` | amtliche Adresse, Grundlage für den `exact`-Abgleich |
| `flstnrzae` / `flstnrnen` | Flurstücksnummer als Zähler und Nenner |
| `flur`, `gemaschl`, `landschl` | Aufbau des Flurstückskennzeichens |
| `flaeche` | Plausibilitätsprüfung, Ausschluss von Splitterflächen |
| `tntxt` | tatsächliche Nutzung, Ausschluss reiner Verkehrsflächen |

Die vollständige Flurstücksnummer wird aus Zähler und Nenner gebaut. Ist ein Nenner vorhanden und nicht `0`, ergibt das die Bruchform:

```ts
nen && nen !== "0" ? `${zae}/${nen}` : zae   // "3119/11" oder "1355"
```

### Die Vorschau im Chat

Die Vorschau ist ein WMS-GetMap-Aufruf auf denselben Kartenausschnitt wie die PDF:

```
https://www.wms.nrw.de/geobasis/wms_nw_alkis
  ?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap
  &LAYERS=adv_alkis_tatsaechliche_nutzung,adv_alkis_flurstuecke,adv_alkis_gebaeude
  &STYLES=&CRS=EPSG:25832
  &BBOX=minE,minN,maxE,maxN
  &WIDTH=…&HEIGHT=900&FORMAT=image/png
```

Die Kommas müssen roh bleiben und dürfen nicht als `%2C` kodiert werden, sonst antwortet der Dienst mit einem Fehler. Die Breite wird aus dem Seitenverhältnis der Bounding-Box gerechnet, damit das Bild nicht verzerrt.

### Lizenz

Die NRW-Geobasisdaten stehen unter Datenlizenz Deutschland Zero. Das erlaubt gewerbliche Nutzung, Weiterverarbeitung und Weitergabe ohne Namensnennungspflicht. Die Lizenz ist nicht in allen Bundesländern gleich und gehört vor einem echten Einsatz je Land einzeln geprüft.

---

## 9. Die MCP-Schicht: was das Modell sieht

### Die Aufteilung der Rückgabe

Ein MCP-Tool gibt drei Dinge zurück, und die Unterscheidung ist wichtiger, als sie aussieht:

| Feld | Wer liest es | Inhalt bei uns |
|---|---|---|
| `structuredContent` | das Modell und die Ansicht | nur die schlanken Metadaten |
| `content` | das Modell als Fließtext | ein Satz, plus Warnhinweis falls nötig |
| `_meta` | ausschließlich die Ansicht | PDF, Download-URL, Vorschaubild |

`_meta` erreicht das Modell nie. Genau deshalb liegen dort die großen Daten.

```ts
const { pdfUrl, pdfDownloadUrl, previewImageUrl, ...metadata } = result;

return {
  structuredContent: metadata,
  content: [{ type: "text", text:
    `Generated Flurkarte PDF for ${result.address} (${result.bundesland}) ` +
    `from ${result.source}.` + (result.warning ? ` ⚠️ ${result.warning}` : "") }],
  _meta: { pdfUrl, pdfDownloadUrl, previewImageUrl },
  isError: false,
};
```

Das war einer der teuersten Fehler im Projekt. In der ersten Fassung stand `structuredContent: result`, also inklusive der PDF als base64-Zeichenkette mit rund 200 Kilobyte. Der Aufruf lief technisch durch, aber der Host brach mit `An error occurred` ab, weil der Kontext des Modells geflutet wurde. Große Daten gehören nie in `structuredContent`.

### Die Werkzeugbeschreibung

Damit das Modell nicht nach Katasterdaten fragt, die der Nutzer nicht kennt, ist die Beschreibung deutlich:

> Generate the official NRW cadastral map for a given German address. IMPORTANT: only the `address` is required, the tool geocodes it and resolves the exact parcel. Do NOT ask the user for Gemarkung, Flur or Flurstueck, those are optional and only used as a fallback. As soon as you have an address, call this tool directly.

Vorher fragte das Modell den Nutzer nach Gemarkung und Flur. Mit dieser Beschreibung ruft es das Werkzeug direkt auf.

### Die Ansicht im Chat

`src/views/get-flurkarte.tsx` ist eine React-Komponente. Sie läuft in einem abgeschotteten iframe, und diese Abschottung bestimmt, was möglich ist.

Zwei Dinge funktionieren dort nicht:

- Ein `data:`-PDF im iframe wird von der Content Security Policy blockiert.
- `useDownload` ist auf Apps-SDK-Hosts nicht verfügbar.

Deshalb arbeitet die Ansicht so:

- Die Vorschau ist ein `<img>` auf die WMS-URL. Bilder sind erlaubt.
- Der Knopf ruft `useOpenExternal` mit der öffentlichen TIM-online-URL auf. Der Host öffnet die PDF im echten Browser.
- `useDownload` mit dem base64-PDF bleibt als Rückfallebene erhalten.

Die passenden Domains stehen in der CSP der Werkzeugdefinition:

```ts
csp: {
  resourceDomains: ["https://www.wms.nrw.de"],        // Vorschaubild
  redirectDomains: ["https://www.tim-online.nrw.de"], // PDF öffnen
}
```

---

## 10. Betriebsverhalten: Timeouts, Retries, Cache, Fallback

### Zahlen

| Parameter | Wert | Begründung |
|---|---|---|
| `REQUEST_TIMEOUT_MS` | 40.000 | MapFish braucht bei großen Ausschnitten Zeit |
| `POLL_INTERVAL_MS` | 1.200 | schont den öffentlichen Dienst |
| `MAX_STATUS_POLLS` | 30 | ergibt etwa 36 Sekunden Geduld |
| `CACHE_TTL_MS` | 600.000 | zehn Minuten |
| Wiederholungen | 2 Versuche | mit 750 Millisekunden Pause |

### Wiederholungen

`fetchWithRetry` bricht jeden Aufruf über einen `AbortController` nach 40 Sekunden ab und versucht es genau einmal erneut. Antworten außerhalb des Erfolgsbereichs werden als Fehler behandelt.

### Cache

Der Cache liegt im Arbeitsspeicher und ist nach Eingabe geschlüsselt, also Adresse, Bundesland und optionale Katasterangaben. Er hat zwei Zwecke: Er beschleunigt Wiederholungen im Gespräch, und er schont die öffentlichen Dienste.

### Rückfallebene

Wenn MapFish nicht antwortet, holt der Adapter ein WMS-Bild und baut daraus mit `pdf-lib` eine einfache PDF mit Kopfzeile. Die Quelle wird dann als `Geobasis NRW (ALKIS WMS fallback)` ausgewiesen, damit erkennbar bleibt, dass das nicht die amtliche Ausgabe ist.

### Rücksicht auf die Dienste

Die Endpunkte sind öffentlich und kostenfrei, aber ohne Zusage zur Verfügbarkeit. Deshalb: nicht schneller als etwa einmal pro Sekunde pollen, Ergebnisse zwischenspeichern, Zeitgrenzen setzen, und ein eigener User-Agent bei Nominatim.

---

## 11. Testwerkzeuge

Ohne schnelle Prüfung dauert jeder Test Minuten, weil man ins Portal muss. Deshalb gibt es zwei Skripte.

### `npm run validate`

Prüft eine Adresse unabhängig vom Adapter, direkt gegen Nominatim und die OGC API.

```bash
npm run validate -- "Massener Kirchweg 33, 59427 Unna"
```

Ausgabe:

```
▸ Massener Kirchweg 33, 59427 Unna
  geocode:  51.53157, 7.65427 | class=building type=yes | hausnr=33 (angefragt 33) ✓
  parcel:   ENTHÄLT Punkt ✓ | Gemarkung=Massen(051406) Flur=004 Flurstück=1355
            | FKZ=05-051406-004-1355 | 795 m²
  raw:      {"objid":"DENW12AL0000MlBxFL", ... "lagebeztxt":"Massener Kirchweg 33", ...}
  VERDICT:  ✅ ECHT
```

Es beantwortet drei Fragen: Existiert die Hausnummer wirklich? Liegt der Punkt in einem Flurstück? Wie sehen die Rohdaten aus? Ohne Argumente läuft eine Mischung aus echten und absichtlich erfundenen Adressen.

### `npm run diagnose`

Ruft die echte Adapterlogik auf, ohne eine PDF zu erzeugen. Das ist die schnelle Schleife beim Entwickeln.

```bash
npm run diagnose -- "Kurfürstenstraße 42, 53913 Swisttal" "Lindenstraße 20, 50674 Köln"
```

Ausgabe:

```
▸ Kurfürstenstraße 42, 53913 Swisttal
  ✅ confidence=exact | FKZ=05-054109-15-245 | scale=1:750

▸ Lindenstraße 20, 50674 Köln
  ✅ confidence=exact | FKZ=05-054958-035-3119/11 | scale=1:750
```

### Was wir damit getestet haben

Adressen quer durch NRW, jeweils mit erwartetem Ergebnis: Düsseldorf, Münster, Dortmund, Aachen, Bielefeld, Köln, Bonn, Essen, Duisburg, Bochum, Unna, Swisttal. Dazu bewusst nicht existierende Hausnummern und erfundene Straßen, die als `approximate` mit Warnung herauskommen müssen.

---

## 12. Gelernte Lektionen

Diese Punkte haben im Projekt Zeit gekostet und sind auf andere Bundesländer übertragbar.

**Große Daten gehören nicht in `structuredContent`.** Die base64-PDF im Modellkontext hat den Host zum Abbruch gebracht. Binärdaten gehören in `_meta`.

**Sandbox-Grenzen kennen.** Im iframe der Ansicht sind `data:`-PDFs und `useDownload` blockiert. Ein `<img>` und `useOpenExternal` funktionieren.

**Die Reihenfolge der WMS-Ebenen entscheidet über das Bild.** Deckende Nutzungsflächen zuoberst verdecken die Gebäude.

**Ein Geocoder ist keine Katasterauskunft.** `Unnaer Straße 1, 59423 Unna` liefert die Straßenachse, nicht ein Gebäude, und landet in keinem Flurstück. Ohne Prüfung entsteht daraus eine plausibel aussehende, aber falsche Karte.

**Nie still raten.** Wer bei unsicherer Zuordnung trotzdem ein Ergebnis liefert, muss das kennzeichnen. Sonst ist der Fehler nicht erkennbar.

**Limits sind eine Fehlerquelle.** Ein zu kleines `limit` schneidet in dichten Gebieten das richtige Flurstück ab, ohne dass ein Fehler entsteht. Das Ergebnis ist einfach falsch.

**Die physische Lage schlägt den Namensabgleich.** Erst prüfen, in welchem Flurstück der Punkt liegt, dann über die Lagebezeichnung bestätigen.

**Amtliche Attribute sind besser als eigene Heuristik.** `lagebeztxt` ist die Adresse, die auch auf der Karte steht. Damit ist der Abgleich belastbar.

---

## 13. Ein neues Bundesland anbinden

### Der Ablauf

1. Neue Datei unter `src/adapters/` anlegen und `FlurkarteAdapter` implementieren.
2. `canHandle` auf die Namen des Bundeslands prüfen lassen.
3. Adresse zu Koordinate auflösen, Koordinate ins metrische Landessystem umrechnen.
4. Flurstücke im engen Umkreis holen, mit ausreichend hohem Limit.
5. Zielflurstück über die drei Stufen wählen und `confidence` setzen.
6. Zentrum, Bounding-Box und Maßstab berechnen, dazu die Formel aus Kapitel 6.
7. Die amtliche Ausgabe holen, entweder über einen Druckdienst oder als Kartenbild.
8. `FlurkarteResult` zurückgeben und den Adapter in `server.ts` in die Liste eintragen.

Nur der letzte Schritt berührt bestehenden Code, und das ist ein Eintrag im Array.

### Was je Land geklärt werden muss

| Frage | Warum sie wichtig ist |
|---|---|
| Koordinatensystem | NRW 25832, Berlin und Brandenburg 25833 |
| Gibt es einen Druckdienst? | sonst muss die Ausgabe selbst gebaut werden |
| Wie heißt die Adressspalte? | in NRW `lagebeztxt`, anderswo anders |
| Lizenzlage | nicht überall Datenlizenz Deutschland Zero |
| Layernamen des WMS | über GetCapabilities prüfen |

### Hinweise für Berlin und Brandenburg

Die dortige Arbeit läuft im Zweig `dokeun` in einem eigenen Projekt. Zwei Punkte aus der Durchsicht:

Die Ausgabe nutzt aktuell `wms_basemapde` mit dem Layer `de_basemapde_web_raster_grau`. Das ist eine graue Basiskarte, keine Katasterkarte. Der ALKIS-Layer ist im Code auskommentiert und muss aktiviert werden.

Es findet bisher keine Flurstücksauflösung statt. Der Ablauf ist Adresse zu Bounding-Box zu Bild, das zentriert die Karte richtig, bestimmt aber kein Flurstück. Dafür braucht es die Abfrage aus Kapitel 5.

Der Bodenrichtwert-Teil über GetFeatureInfo ist fachlich wertvoll für die Finanzierung und sollte erhalten bleiben.

---

## 14. Grenzen und offene Punkte

**Kein beglaubigter Auszug.** Das Ergebnis ist die amtliche Kartenausgabe des Landes und trägt den Hinweis, dass es keine amtliche Standardausgabe ist. Für beglaubigte Unterlagen führt der Weg weiter über das Katasteramt.

**Abhängigkeit von öffentlichen Diensten.** Die Endpunkte sind kostenfrei nutzbar, aber ohne Zusage zur Verfügbarkeit. Wenn ein Land sein Portal umbaut, bricht der Adapter. Das braucht Beobachtung und Pflege.

**Adressqualität.** Nominatim kennt nicht jede Hausnummer. Für unklare Fälle bleibt der manuelle Weg, deshalb die Warnung statt eines stillen Ergebnisses.

**Ein Flurstück, eine Lagebezeichnung.** Steht auf einem Grundstück mehr als ein Gebäude, trägt das Flurstück trotzdem nur eine Lagebezeichnung. Für normale Wohnadressen passt die Zuordnung, bei größeren Anlagen kann sie ungenau sein.

**Betrieb ist ungeklärt.** Heute ist das ein Prototyp aus einer Hack Night. Wer die Anwendung betreut, wenn sich ein Landesportal ändert, ist noch nicht festgelegt.

**Nur ein Bundesland ist fertig.** NRW läuft, Berlin und Thüringen sind in Arbeit, dreizehn Länder fehlen.

---

## 15. Anhang

### Glossar

| Begriff | Bedeutung |
|---|---|
| ALKIS | Amtliches Liegenschaftskatasterinformationssystem |
| Flurstück | das einzelne Grundstück im Kataster |
| Flur | Gruppe von Flurstücken innerhalb einer Gemarkung |
| Gemarkung | Katasterbezirk, meist ein Ortsteil |
| Lagebezeichnung | amtliche Adresse eines Flurstücks, Attribut `lagebeztxt` |
| Zuwegung | Anbindung des Grundstücks an eine öffentliche Straße |
| WMS | Web Map Service, liefert Kartenbilder |
| OGC API Features | Schnittstelle für Geoobjekte als GeoJSON |
| MapFish Print | Druckdienst, den TIM-online für PDF-Ausgaben nutzt |
| MCP | Model Context Protocol, Schnittstelle zwischen Modell und Werkzeug |
| EPSG:25832 | UTM Zone 32 auf ETRS89, metrisch, für NRW |

### Kommandos

```bash
cd app
npm install
npm run dev                                    # lokal, MCP auf localhost:3000/mcp
npm run dev -- --tunnel                        # öffentlicher Tunnel zum Testen in ChatGPT
npm run validate -- "Adresse"                  # unabhängige Adressprüfung
npm run diagnose -- "Adresse"                  # echte Adapterlogik ohne PDF
npm run build
npx alpic@latest deploy --non-interactive      # Deployment
```

### Milestone-Historie

| Schritt | Inhalt |
|---|---|
| B1 | fest verdrahtete TIM-online-PDF, Beweis, dass der Druckdienst ohne Browser funktioniert |
| B2 | Auflösung über Katasterangaben per OGC API |
| B3 | Auflösung über Adressen |
| B4 | Ausgabe finalisiert, Titel und Dateiname |
| B5 | Markierung, Beschriftung, Zentrierung, Maßstabsleiter |
| B6 | Reihenfolge der WMS-Ebenen korrigiert, Gebäude sichtbar |
| B7 | Werkzeugbeschreibung geschärft, Modell fragt nicht mehr nach Katasterdaten |
| B8 | PDF nach `_meta` verschoben, Ansicht ergänzt, Host-Abbruch behoben |
| B8b | PDF über `useOpenExternal` öffnen, sandboxfest |
| B9 | dreistufige Auflösung mit `confidence` und Warnung |
| B10 | Suchradius und Limit korrigiert, kein Abschneiden mehr in dichten Gebieten |
| B11 | Beschriftung unter das Flurstück verschoben |
| B12 | Kartenvorschau im Chat über WMS |
| B13 | enthaltender Punkt hat Vorrang, Mehrfachadressen, näherer Zoom |

### Verweise

- Live-Playground: https://instant-flurkarte-82497296.alpic.live/try
- MCP-Endpunkt: https://instant-flurkarte-82497296.alpic.live/mcp
- Repository: https://github.com/klodulf78/Instant_Flurkarte
- Skybridge-Dokumentation: https://docs.skybridge.tech
