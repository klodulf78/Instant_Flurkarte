// Shared contract for Instant Flurkarte.
// Every state adapter (NRW, Berlin, Thüringen) implements FlurkarteAdapter.
// Keep this file IDENTICAL across branches — it is the merge contract on `main`.

export interface FlurkarteInput {
  address?: string; // e.g. "Domkloster 4, 50667 Köln"
  bundesland?: string; // "NRW" | "Berlin" | "Thüringen" | ...
  gemarkung?: string;
  flur?: string;
  flurstueck?: string;
}

export interface FlurkarteResult {
  pdfUrl: string; // data:application/pdf;base64,... (canonical artifact)
  /**
   * Optional public https URL serving the PDF directly (e.g. the TIM-online
   * MapFish report URL). Used by the view to open the PDF in the user's
   * browser via useOpenExternal, since sandboxed iframes block data: PDFs and
   * useDownload is unavailable on Apps-SDK hosts.
   */
  pdfDownloadUrl?: string;
  /** Official ALKIS WMS image of the map extent, for an inline chat preview. */
  previewImageUrl?: string;
  flurstueckskennzeichen: string;
  address: string;
  bundesland: string;
  source: string; // e.g. "Geobasis NRW (ALKIS WMS + OGC API)"
  extractedAt: string; // ISO 8601
  /**
   * How confidently the address was matched to a parcel:
   *  - "exact": authoritative lagebeztxt match (street + house number)
   *  - "containing": geocoded point falls inside the parcel
   *  - "approximate": nearest-parcel fallback — result is NOT guaranteed
   */
  confidence?: "exact" | "containing" | "approximate";
  /** Human-readable caveat shown to the user when confidence is low. */
  warning?: string;
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
