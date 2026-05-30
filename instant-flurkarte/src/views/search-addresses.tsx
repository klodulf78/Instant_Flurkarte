import { useEffect } from "react";
import { useToolInfo, useCallTool, useViewState } from "skybridge/web";

interface Address {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  class: string;
  type: string;
  place_rank: number;
  importance: number;
  addresstype: string;
  name: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    borough?: string;
    city?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  boundingbox: string[];
}

export default function SearchAddresses() {
  const { output } = useToolInfo();
  const { callTool: getBerlinMap } = useCallTool("get_berlin_map" as any);
  const [currentIndex, setCurrentIndex] = useViewState<{ index: number }>({ index: 0 });

  const addresses = (output as any)?.structuredContent?.addresses || [];

  const handlePrevious = () => {
    setCurrentIndex((prev) => ({ 
      index: prev.index > 0 ? prev.index - 1 : addresses.length - 1 
    }));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => ({ 
      index: prev.index < addresses.length - 1 ? prev.index + 1 : 0 
    }));
  };

  const handleSelect = (address: Address) => {
    (getBerlinMap as any)(
      { address: address.display_name },
      {
        onSuccess: () => {
          console.log('Map request successful');
        }
      }
    );
  };

  console.log("addresses", addresses);
  console.log("output", output);

  useEffect(() => {
    console.log("currentIndex", currentIndex);
  }, [currentIndex]);

  if (addresses.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <div className="text-gray-500 py-8">
          No addresses found. Please try a different search term.
        </div>
      </div>
    );
  }

  const currentAddress = addresses[currentIndex.index];

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Select an Address</h2>
      <p className="text-gray-600 mb-6">
        Found {addresses.length} address(es). Navigate through the carousel and select one:
      </p>

      <div className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-500">
              {currentIndex.index + 1} of {addresses.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handlePrevious}
                disabled={addresses.length <= 1}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={handleNext}
                disabled={addresses.length <= 1}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {currentAddress.display_name}
              </h3>
              {currentAddress.address.postcode && (
                <p className="text-sm text-gray-600">
                  {currentAddress.address.city}, {currentAddress.address.postcode}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-4">
              <div>
                <span className="font-medium">Coordinates:</span>
                <br />
                {currentAddress.lat}, {currentAddress.lon}
              </div>
              <div>
                <span className="font-medium">Type:</span>
                <br />
                {currentAddress.addresstype}
              </div>
            </div>

            <button
              onClick={() => handleSelect(currentAddress)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Select This Address →
            </button>
          </div>
        </div>

        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
          <div className="flex justify-center gap-1">
            {addresses.map((_: any, idx: number) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex({ index: idx })}
                className={`w-2 h-2 rounded-full transition-colors ${
                  idx === currentIndex.index ? 'bg-blue-600' : 'bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-2">💡 Tip:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Use the Previous/Next buttons to navigate through addresses</li>
          <li>Click the dots at the bottom to jump to a specific address</li>
          <li>Select an address to view its Berlin property value map</li>
        </ul>
      </div>
    </div>
  );
}
