# InfoLika Thüringen Request Flow

Source viewer:

```txt
https://thueringenviewer.thueringen.de/thviewer3/infolika.html
```

The implementation uses direct HTTP requests. Playwright was only used to inspect the dynamic viewer.

## Address Search

Config:

```txt
https://thueringenviewer.thueringen.de/thviewer3/th-config/rest-services.json
```

The address module uses service id `21`, a WFS endpoint with `TYPENAMES=tlvermgeo:GAZHKO_STREET`.

Municipality:

```txt
GET https://www.geoproxy.geoportal-th.de/geoproxy/services
  REQUEST=GetFeature
  SERVICE=WFS
  SRSNAME=EPSG:25832
  TYPENAMES=tlvermgeo:GAZHKO_STREET
  VERSION=2.0.0
  StoredQuery_ID=findeGemeinde
  gemeinde=Erfurt
```

Street list for the municipality:

```txt
GET https://www.geoproxy.geoportal-th.de/geoproxy/services
  ...same base params...
  StoredQuery_ID=findeStrasse
  gemkennzahl=51000
```

House numbers for the street:

```txt
GET https://www.geoproxy.geoportal-th.de/geoproxy/services
  ...same base params...
  StoredQuery_ID=findeHausnummer
  strkscomid=5100003032
  hausnr=
```

For `Große Arche 14, 99084 Erfurt`, the house-number point is:

```txt
642244.004 5649191.892
```

## Parcel Lookup

InfoLika uses service id `12`:

```txt
https://www.geoproxy.geoportal-th.de/geoproxy/services/alkis_onlika_wfs
```

The viewer queries a tiny bbox around the point:

```txt
GET /geoproxy/services/alkis_onlika_wfs
  REQUEST=GetFeature
  SERVICE=WFS
  SRSNAME=EPSG:25832
  CRS=25832
  minX=642244.004
  minY=5649191.892
  maxX=642244.005
  maxY=5649191.893
  TYPENAMES=adv:EX_Flurstueck
  VERSION=2.0.0
  StoredQuery_ID=findeONLIKAFKZByBBox
  outputFormat=text/xml; subtype=gml/2.1.2
```

For the test address this returns:

```txt
Flurstueckskennzeichen: 16010114100159______
identifier: urn:adv:oid:DETHL51P0000enWm
```

## Cadastral Parcel Information

InfoLika uses service id `13`:

```txt
https://www.geoproxy.geoportal-th.de/geoproxy/services/il_show_fkz
```

The endpoint returns the HTML tables shown in the right sidebar:

```txt
GET /geoproxy/services/il_show_fkz
  id=urn:adv:oid:DETHL51P0000enWm
  csv=no
  srid=25832
  minx=642219.091
  miny=5649165.105
  maxx=642258.765
  maxy=5649199.158
```

The public viewer bundle includes a `SessionID`, but the endpoint answered without it during testing, so the prototype does not send that value.

## Official PDF Generation

The print module uses service id `99997`:

```txt
POST https://www.geoproxy.geoportal-th.de/geoengine/create.json
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
```

The body is the raw JSON payload built by the viewer's `thPrint` module. It includes:

```txt
layout: InfoLIKA A4 hoch 1000
outputFormat: pdf
srs: EPSG:25832
layers: TH-ALKIS_infolika via ALKISINFOLIKA WMS
addparamtype: infolika
addparam: parcel labels and FKZ highlight id
```

The response contains the official downloadable PDF URL:

```json
{"getURL":"https://www.geoproxy.geoportal-th.de/download-service/pdf/InfoLika_Ausgabe_....pdf"}
```
