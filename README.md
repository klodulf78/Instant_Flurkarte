# Instant Flurkarte

Hackathon prototype for the shared MCP tool:

```js
get_flurkarte({ address?, bundesland?, gemarkung?, flur?, flurstueck? })
```

The first implementation supports address-based searches in Thüringen via InfoLika / Thüringen Viewer.

## Hackathon Demo

```bash
npm install
npm run demo
```

Open `http://localhost:3000` for the polished product demo. The UI calls the same direct Thüringen implementation and keeps the shared MCP output contract unchanged.

## Run the Thüringen Smoke Test

```bash
npm test
```

The test calls the live InfoLika/Geoengine services for:

```txt
Große Arche 14, 99084 Erfurt
```

It returns an official state-portal PDF URL from `https://www.geoproxy.geoportal-th.de/download-service/pdf/...`.

## MCP Server

Install dependencies first, then run:

```bash
npm install
npm run smoke:thueringen
node src/server.js
```

The MCP server exposes `get_flurkarte` and delegates to the same direct HTTP implementation.

## Thüringen Endpoint Notes

See [docs/infolika-thueringen.md](docs/infolika-thueringen.md) for the explored InfoLika request flow.
