import { useState } from "react";
import { useToolInfo, useDownload, useFiles } from "skybridge/web";
import { FileImage, FileText, Layers, Map, Info, AlertTriangle } from "lucide-react";
import jsPDF from "jspdf";
import "../index.css";

export default function FlurkarteMap() {
  const { output, responseMetadata } = useToolInfo();
  const { download } = useDownload();
  const { upload, getDownloadUrl } = useFiles();
  const [isDownloadingPNG, setIsDownloadingPNG] = useState(false);
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);

  // Read image data from _meta (previewImageUrl or pdfUrl)
  const previewImageUrl = (responseMetadata as any)?.previewImageUrl as string | undefined;
  const pdfUrl = (responseMetadata as any)?.pdfUrl as string | undefined;
  const imageData = previewImageUrl || pdfUrl;
  
  // Read structured data from output
  const address = (output as any)?.address as string | undefined;
  const flurstueckskennzeichen = (output as any)?.flurstueckskennzeichen as string | null | undefined;
  const bundesland = (output as any)?.bundesland as string | undefined;
  const confidence = (output as any)?.confidence as string | undefined;
  const warning = (output as any)?.warning as string | null | undefined;
  const zoomLevel = (output as any)?.zoomLevel as number | undefined;

  console.log("FlurkarteMap data:", { 
    imageData: imageData ? imageData.substring(0, 50) + '...' : 'undefined', 
    previewImageUrl: previewImageUrl ? 'present' : 'undefined',
    pdfUrl: pdfUrl ? 'present' : 'undefined',
    address, 
    flurstueckskennzeichen, 
    bundesland, 
    confidence, 
    warning, 
    zoomLevel,
    responseMetadata: JSON.stringify(responseMetadata).substring(0, 200),
    output: JSON.stringify(output).substring(0, 200)
  });

  const handleDownloadPNG = async () => {
    if (!imageData) return;
    setIsDownloadingPNG(true);
    try {
      const filename = `flurkarte-${address?.replace(/[^a-zA-Z0-9]/g, '_') || 'map'}.png`;

      // 1. Try useDownload (for MCP environments like DevTools UI, Claude Desktop, etc.)
      try {
        const base64Data = imageData.includes("base64,")
          ? imageData.split("base64,")[1]
          : imageData;

        const result = await download({
          contents: [
            {
              type: "resource",
              resource: {
                uri: `file:///${filename}`,
                mimeType: "image/png",
                blob: base64Data,
              },
            },
          ],
        });
        if (result && !result.isError) {
          console.log("MCP useDownload for PNG succeeded.");
          return;
        }
      } catch (err) {
        console.warn("MCP useDownload failed, falling back to useFiles...", err);
      }

      // 2. Try useFiles (for ChatGPT Apps SDK environment)
      try {
        console.log("Attempting ChatGPT useFiles for PNG...");
        const response = await fetch(imageData);
        const blob = await response.blob();
        const file = new File([blob], filename, { type: "image/png" });

        const { fileId } = await upload(file);
        const { downloadUrl } = await getDownloadUrl({ fileId });
        window.open(downloadUrl, "_blank");
        console.log("ChatGPT useFiles for PNG succeeded.");
        return;
      } catch (err) {
        console.warn("ChatGPT useFiles failed, falling back to document write...", err);
      }

      // 3. Try opening in a new styled tab and writing to document (bypasses iframe sandbox download block)
      try {
        console.log("Attempting new tab document write for PNG...");
        const newWindow = window.open("", "_blank");
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>Berlin Flurkarte - PNG Export</title>
                <style>
                  body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0f172a; height: 105vh; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: white; }
                  .container { text-align: center; max-width: 90%; }
                  img { max-width: 100%; max-height: 75vh; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px; transition: transform 0.3s; }
                  img:hover { transform: scale(1.01); }
                  h1 { font-size: 22px; font-weight: 800; margin: 0 0 8px 0; background: linear-gradient(to right, #10b981, #14b8a6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                  p { font-size: 14px; opacity: 0.8; margin: 0; }
                  .btn-download { display: inline-block; margin-top: 15px; padding: 10px 20px; background: #10b981; color: white; font-weight: bold; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2); }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>Berlin Cadastral Map (Flurkarte)</h1>
                  <img src="${imageData}" alt="Flurkarte" />
                  <p>Right-click the map image above and select <strong>"Save Image As..."</strong> to download it to your device.</p>
                  <a href="${imageData}" download="${filename}" class="btn-download">Direct Download Link</a>
                </div>
              </body>
            </html>
          `);
          newWindow.document.close();
          console.log("New tab document write for PNG succeeded.");
          return;
        }
      } catch (err) {
        console.warn("New tab document write for PNG failed, falling back to standard link click...", err);
      }

      // 4. Fallback to standard browser download (last resort)
      console.log("Attempting browser link click fallback for PNG...");
      const link = document.createElement('a');
      link.href = imageData;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("Browser link click fallback completed.");
    } catch (err) {
      console.error("All PNG download methods failed:", err);
    } finally {
      setIsDownloadingPNG(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!imageData) return;
    setIsDownloadingPDF(true);
    
    try {
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });
      
      const img = new Image();
      img.onload = async () => {
        const filename = `flurkarte-${address?.replace(/[^a-zA-Z0-9]/g, '_') || 'map'}.pdf`;
        
        try {
          const imgWidth = 280;
          const imgHeight = (img.height * imgWidth) / img.width;
          const x = (297 - imgWidth) / 2;
          const y = 20;
          
          pdf.setFontSize(16);
          pdf.text(`Berlin Flurkarte - ${address}`, 148.5, 10, { align: 'center' });
          pdf.setFontSize(10);
          pdf.text(`Zoom Level: ${zoomLevel} | Generated: ${new Date().toLocaleDateString()}`, 148.5, 16, { align: 'center' });
          pdf.addImage(imageData!, 'PNG', x, y, imgWidth, imgHeight);
          
          const pdfDataUri = pdf.output('datauristring');
          const base64Pdf = pdfDataUri.includes("base64,")
            ? pdfDataUri.split("base64,")[1]
            : pdfDataUri;

          // 1. Try useDownload (for MCP environments like DevTools UI, Claude Desktop, etc.)
          try {
            console.log("Attempting MCP useDownload for PDF...");
            const result = await download({
              contents: [
                {
                  type: "resource",
                  resource: {
                    uri: `file:///${filename}`,
                    mimeType: "application/pdf",
                    blob: base64Pdf,
                  },
                },
              ],
            });
            if (result && !result.isError) {
              console.log("MCP useDownload for PDF succeeded.");
              setIsDownloadingPDF(false);
              return;
            }
          } catch (err) {
            console.warn("MCP useDownload failed for PDF, falling back to useFiles...", err);
          }

          // 2. Try useFiles (for ChatGPT Apps SDK environment)
          try {
            console.log("Attempting ChatGPT useFiles for PDF...");
            const response = await fetch(pdfDataUri);
            const blob = await response.blob();
            const file = new File([blob], filename, { type: "application/pdf" });
            
            const { fileId } = await upload(file);
            const { downloadUrl } = await getDownloadUrl({ fileId });
            window.open(downloadUrl, "_blank");
            console.log("ChatGPT useFiles for PDF succeeded.");
            setIsDownloadingPDF(false);
            return;
          } catch (err) {
            console.warn("ChatGPT useFiles failed for PDF, falling back to iframe popout...", err);
          }

          // 3. Try opening in a new tab with embedded PDF iframe (bypasses iframe sandbox PDF download block)
          try {
            console.log("Attempting new tab iframe document write for PDF...");
            const newWindow = window.open("", "_blank");
            if (newWindow) {
              newWindow.document.write(`
                <html>
                  <head>
                    <title>Berlin Flurkarte - PDF Export</title>
                    <style>
                      body { margin: 0; padding: 0; background: #0f172a; height: 100vh; width: 100vw; display: flex; flex-direction: column; }
                      iframe { flex-grow: 1; border: none; width: 100%; height: 100%; }
                    </style>
                  </head>
                  <body>
                    <iframe src="${pdfDataUri}"></iframe>
                  </body>
                </html>
              `);
              newWindow.document.close();
              console.log("New tab iframe document write for PDF succeeded.");
              setIsDownloadingPDF(false);
              return;
            }
          } catch (err) {
            console.warn("New tab iframe document write for PDF failed, falling back to standard pdf.save...", err);
          }

          // 4. Fallback to standard browser pdf.save (last resort)
          console.log("Attempting standard browser PDF save fallback...");
          pdf.save(filename);
          console.log("Browser PDF save fallback completed.");
        } catch (innerErr) {
          console.error("PDF generation/upload failed:", innerErr);
        } finally {
          setIsDownloadingPDF(false);
        }
      };
      img.onerror = (err) => {
        console.error("Failed to load map image for PDF:", err);
        setIsDownloadingPDF(false);
      };
      img.src = imageData;
    } catch (err) {
      console.error("PDF download failed:", err);
      setIsDownloadingPDF(false);
    }
  };

  if (!imageData) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center glass-panel rounded-2xl shadow-xl border border-slate-205/50 dark:border-slate-800/50 animate-fade-in">
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-pulse"></div>
            <div className="animate-spin rounded-full h-14 w-14 border-4 border-slate-200/50 dark:border-slate-800/50 border-t-emerald-500 relative z-10"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">Loading Map Data</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-xs text-sm">
            Fetching the official cadastral parcels from the Berlin GDI Web Map Service...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto animate-fade-in">
      {/* Header Widget Section */}
      <div className="mb-6 text-center md:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-3 border border-emerald-500/25">
          <Layers size={14} className="animate-pulse" />
          Official GDI Berlin WMS
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
          Berlin Flurkarte
        </h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm">
          Official cadastral map showing precise property boundaries and parcel numbers.
        </p>
      </div>

      {/* Main Glass Panel Card */}
      <div className="glass-panel border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300">
        <div className="p-6 md:p-8">
          {/* Warning Banner */}
          {warning && (
            <div className="mb-6 p-4 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-orange-800 dark:text-orange-300">⚠️ {warning}</p>
              </div>
            </div>
          )}

          {/* Metadata Section */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-slate-200/50 dark:border-slate-800/50">
            <div className="flex gap-2.5 items-start">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-855 text-slate-600 dark:text-slate-400 mt-0.5">
                <Map size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-850 dark:text-white leading-tight">
                  📍 {address}
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                    Zoom Level: <strong className="font-semibold text-slate-700 dark:text-slate-350">{zoomLevel}</strong> (Scale: 1-10)
                  </span>
                  {flurstueckskennzeichen && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                      Flurstück: <strong className="font-semibold text-slate-700 dark:text-slate-350">{flurstueckskennzeichen}</strong>
                    </span>
                  )}
                  {confidence && (
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
                      confidence === 'exact' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                      confidence === 'containing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                    }`}>
                      Confidence: <strong className="font-semibold">{confidence}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Map Image Panel with Shadow Effect */}
          <div className="mb-6 relative group overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <img
              src={imageData}
              alt="Berlin Flurkarte (Cadastral Map)"
              className="w-full h-auto object-cover max-h-[350px] transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 pointer-events-none border border-black/5 dark:border-white/5 rounded-xl shadow-inner"></div>
          </div>

          {/* Action Buttons Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <button
              onClick={handleDownloadPNG}
              disabled={isDownloadingPNG || isDownloadingPDF}
              className="py-3 px-5 bg-gradient-to-r from-emerald-500 to-teal-650 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl shadow-md shadow-emerald-500/10 hover:shadow-emerald-600/25 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloadingPNG ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
              ) : (
                <FileImage size={18} />
              )}
              {isDownloadingPNG ? "Preparing PNG..." : "Download PNG Image"}
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloadingPNG || isDownloadingPDF}
              className="py-3 px-5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-bold rounded-xl shadow-md shadow-slate-950/10 hover:shadow-slate-950/20 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-slate-700/30 dark:border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloadingPDF ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-700 dark:border-slate-400 border-t-transparent" />
              ) : (
                <FileText size={18} />
              )}
              {isDownloadingPDF ? "Preparing PDF..." : "Export Landscape PDF"}
            </button>
          </div>
        </div>
      </div>

      {/* Information Tip Box */}
      <div className="mt-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 flex gap-3 text-sm">
        <Info className="h-5 w-5 text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
        <div className="text-slate-600 dark:text-slate-400">
          <p className="font-bold text-slate-800 dark:text-slate-200 mb-1">About the Flurkarte Map:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>The **Flurkarte** is the official cadastral map of Germany, charting boundaries, parcel reference numbers, and building footprints.</li>
            <li>Maintained directly by local state surveying offices (**Katasteramt**).</li>
            <li>Crucial for property evaluation, legal real estate transactions, and construction planning.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
