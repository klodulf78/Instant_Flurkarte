import test from "node:test";
import assert from "node:assert/strict";
import { get_flurkarte } from "../src/infolika-thueringen.js";

const silentLogger = {
  info() {},
  warn() {},
  error() {}
};

test("gets the official InfoLika PDF for Große Arche 14, Erfurt", { timeout: 60000 }, async () => {
  const result = await get_flurkarte({
    address: "Große Arche 14, 99084 Erfurt",
    bundesland: "Thüringen"
  }, { logger: silentLogger });

  assert.match(result.pdfUrl, /^https:\/\/www\.geoproxy\.geoportal-th\.de\/download-service\/pdf\/InfoLika_Ausgabe_.*\.pdf$/);
  assert.equal(result.flurstueckskennzeichen, "16010114100159______");
  assert.equal(result.address, "Große Arche 14");
  assert.equal(result.bundesland, "Thüringen");
  assert.equal(result.source, "InfoLika / Thüringen Viewer");
  assert.ok(Date.parse(result.extractedAt));
});
