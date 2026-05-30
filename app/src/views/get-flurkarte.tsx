import "@/index.css";

import { useState } from "react";
import { useDownload, useLayout, useOpenExternal } from "skybridge/web";
import { useToolInfo } from "../helpers.js";

function sanitizeFilename(name: string): string {
  return (name || "Flurkarte").replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export default function GetFlurkarte() {
  const { theme } = useLayout();
  const { output, responseMetadata, isPending } =
    useToolInfo<"get_flurkarte">();
  const openExternal = useOpenExternal();
  const { download } = useDownload();
  const [saving, setSaving] = useState(false);

  const meta = responseMetadata as
    | { pdfUrl?: string; pdfDownloadUrl?: string }
    | undefined;
  const pdfUrl = meta?.pdfUrl;
  const pdfDownloadUrl = meta?.pdfDownloadUrl;
  const address = output?.address ?? "";
  const title = `Flurkarte_${address}`;
  const canGet = Boolean(pdfDownloadUrl || pdfUrl);
  const warning = output?.warning;

  // Prefer opening the official https PDF in the browser (reliable in
  // sandboxed hosts). Fall back to a host-mediated download of the base64.
  const handleOpen = async () => {
    if (pdfDownloadUrl) {
      openExternal(pdfDownloadUrl, { redirectUrl: false });
      return;
    }
    if (!pdfUrl) return;
    setSaving(true);
    try {
      const base64 = pdfUrl.split(",")[1] ?? "";
      await download({
        contents: [
          {
            type: "resource",
            resource: {
              uri: `file:///${sanitizeFilename(address)}.pdf`,
              mimeType: "application/pdf",
              blob: base64,
            },
          },
        ],
      });
    } finally {
      setSaving(false);
    }
  };

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6 text-foreground">
        Lade amtliche Flurkarte…
      </div>
    );
  }

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} mx-auto w-full max-w-3xl border border-border overflow-hidden bg-background text-foreground`}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="opacity-60">Adresse</dt>
              <dd>{output?.address}</dd>
              <dt className="opacity-60">Flurstück</dt>
              <dd>{output?.flurstueckskennzeichen}</dd>
              <dt className="opacity-60">Bundesland</dt>
              <dd>{output?.bundesland}</dd>
              <dt className="opacity-60">Quelle</dt>
              <dd>{output?.source}</dd>
            </dl>
          </div>
          <button
            type="button"
            onClick={handleOpen}
            disabled={!canGet || saving}
            className="shrink-0 rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {saving ? "Speichere…" : "PDF öffnen"}
          </button>
        </div>

        {warning ? (
          <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-200">
            ⚠️ {warning}
          </div>
        ) : null}

        {pdfDownloadUrl ? (
          <iframe
            title={title}
            src={pdfDownloadUrl}
            className="w-full rounded-md border border-border bg-white"
            style={{ height: 560 }}
          />
        ) : (
          <div className="rounded-md border border-border p-6 text-sm opacity-70">
            Vorschau hier nicht verfügbar — über „PDF öffnen" die amtliche
            Flurkarte im Browser anzeigen.
          </div>
        )}
      </div>
    </div>
  );
}
