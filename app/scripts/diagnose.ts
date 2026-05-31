/**
 * Exercise the REAL adapter resolver (geocode + lagebeztxt/containment +
 * confidence), without generating a PDF. Fast loop for tuning correctness.
 *
 *   npm run diagnose -- "Massener Kirchweg 33, 59427 Unna" "Ringstraße 21, 59427 Unna"
 */
import { resolvePrintTarget } from "../src/adapters/nrw.js";

const DEFAULTS = [
  "Massener Kirchweg 33, 59427 Unna", // real → expect exact/containing
  "Ringstraße 21, 59427 Unna", // real → expect exact/containing
  "Unnaer Straße 1, 59423 Unna", // not a building → expect approximate + warning
];

const mark = (c: string) =>
  c === "exact" ? "✅" : c === "containing" ? "🟢" : "⚠️ ";

async function main() {
  const addresses = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULTS;
  for (const address of addresses) {
    try {
      const t = await resolvePrintTarget({ address });
      console.log(
        `\n▸ ${address}\n  ${mark(t.confidence)} confidence=${t.confidence}` +
          ` | FKZ=${t.flurstueckskennzeichen} | scale=1:${t.scale}` +
          ` | matched="${t.address}"` +
          (t.warning ? `\n  ⚠️  ${t.warning}` : ""),
      );
    } catch (e) {
      console.log(`\n▸ ${address}\n  ❌ ERROR: ${(e as Error).message}`);
    }
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
