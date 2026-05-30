import { useEffect } from "react";
import { useToolInfo, useViewState } from "skybridge/web";

export default function FlurkarteMap() {
  const { output } = useToolInfo();
  const [mapData, setMapData] = useViewState<{ 
    imageData: string | null;
    address: string | null;
    zoomLevel: number | null;
  }>({ 
    imageData: null, 
    address: null, 
    zoomLevel: null 
  });

  useEffect(() => {
    console.log("FlurkarteMap output:", output);
    const imageData = (output as any)?.imageData;
    const address = (output as any)?.address;
    const zoomLevel = (output as any)?.zoomLevel;
    
    console.log("FlurkarteMap extracted data:", { imageData, address, zoomLevel });
    
    if (imageData && imageData !== mapData.imageData) {
      setMapData({ imageData, address, zoomLevel });
    }
  }, [output, setMapData, mapData.imageData]);

  const handleDownload = () => {
    if (!mapData.imageData) return;
    
    const link = document.createElement('a');
    link.href = mapData.imageData;
    link.download = `flurkarte-${mapData.address?.replace(/[^a-zA-Z0-9]/g, '_') || 'map'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!mapData.imageData) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-green-600 mb-4"></div>
          <div className="text-gray-600">
            Loading Flurkarte map data...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Berlin Flurkarte (Cadastral Map)</h2>
      <p className="text-gray-600 mb-6">
        Official cadastral map showing property boundaries and parcel information for Berlin.
      </p>

      <div className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
        <div className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              📍 {mapData.address}
            </h3>
            <p className="text-sm text-gray-600">
              Zoom Level: {mapData.zoomLevel} (1=closest, 10=furthest)
            </p>
          </div>

          <div className="mb-4">
            <img
              src={mapData.imageData}
              alt="Berlin Flurkarte (Cadastral Map)"
              className="w-full h-auto border border-gray-300 rounded"
            />
          </div>

          <button
            onClick={handleDownload}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Flurkarte Map
          </button>
        </div>
      </div>

      <div className="mt-6 p-4 bg-green-50 rounded-lg text-sm text-green-800">
        <p className="font-medium mb-2">💡 About Flurkarte:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Flurkarte is the official cadastral map of Germany</li>
          <li>Shows property boundaries, parcel numbers, and land use information</li>
          <li>Maintained by the official land registry (Katasteramt)</li>
          <li>Essential for property transactions and land planning</li>
        </ul>
      </div>
    </div>
  );
}
