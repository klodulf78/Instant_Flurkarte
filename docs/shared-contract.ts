// Shared contract for Instant Flurkarte.
// Every state adapter (NRW, Berlin, Thüringen) implements FlurkarteAdapter.
// Keep this file IDENTICAL across branches — it lives on `main`.
// Suggested location in the app: app/src/shared/contract.ts

export interface FlurkarteInput {
  address?: string; // e.g. "Domkloster 4, 50667 Köln"
  bundesland?: string; // "NRW" | "Berlin" | "Thüringen" | ...
  gemarkung?: string;
  flur?: string;
  flurstueck?: string;
}

export interface FlurkarteResult {
  pdfUrl: string;
  flurstueckskennzeichen: string;
  address: string;
  bundesland: string;
  source: string; // e.g. "Geobasis NRW (ALKIS WMS + OGC API)"
  extractedAt: string; // ISO 8601
}

/** One adapter per Bundesland. Same in/out everywhere → clean merge. */
export interface FlurkarteAdapter {
  /** Bundesland this adapter serves, e.g. "NRW". */
  readonly bundesland: string;
  /** Can this adapter handle the given input (state match / id format)? */
  canHandle(input: FlurkarteInput): boolean;
  /** Resolve parcel → render official map → return bank-conform PDF. */
  getFlurkarte(input: FlurkarteInput): Promise<FlurkarteResult>;
}

/** The MCP tool routes to the first adapter that can handle the input. */
export function selectAdapter(
  input: FlurkarteInput,
  adapters: FlurkarteAdapter[],
): FlurkarteAdapter {
  const adapter = adapters.find((a) => a.canHandle(input));
  if (!adapter) {
    throw new Error(
      `No adapter for input: ${JSON.stringify(input)} (supported: ${adapters
        .map((a) => a.bundesland)
        .join(", ")})`,
    );
  }
  return adapter;
}
