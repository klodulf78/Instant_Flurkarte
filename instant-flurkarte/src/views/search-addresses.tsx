import { useState, useEffect } from "react";
import { useToolInfo, useCallTool, useViewState } from "skybridge/web";
import { MapPin, ChevronLeft, ChevronRight, Compass, Info, Navigation, Loader2 } from "lucide-react";
import "../index.css";

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
  const { callTool: getBerlinMap, isPending: isSelecting } = useCallTool("get_berlin_map" as any);
  const [currentIndex, setCurrentIndex] = useViewState<{ index: number }>({ index: 0 });
  const [loadingStep, setLoadingStep] = useState(0);

  const addresses = (output as any)?.structuredContent?.addresses || [];

  const loadingMessages = [
    "Resolving address coordinates...",
    "Transforming WGS84 to Berlin UTM metrics (EPSG:25833)...",
    "Connecting to GDI Berlin Web Map Service...",
    "Retrieving land registry cadastral layers...",
    "Preparing high-resolution parcel visualization..."
  ];

  useEffect(() => {
    if (!isSelecting) {
      setLoadingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [isSelecting]);

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

  // Full screen loading card during address selection
  if (isSelecting) {
    return (
      <div className="p-8 max-w-2xl mx-auto animate-fade-in">
        <div className="glass-panel border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden py-16 px-8 text-center flex flex-col items-center justify-center min-h-[420px]">
          {/* Animated Locator & Spinner */}
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 blur-xl animate-pulse scale-150"></div>
            <div className="relative z-10 flex items-center justify-center h-20 w-20 rounded-full border border-slate-200/40 dark:border-slate-800/40 bg-white/40 dark:bg-slate-900/40">
              <Loader2 className="animate-spin h-14 w-14 text-emerald-500 absolute" />
              <Navigation className="h-6 w-6 text-emerald-500 animate-pulse-glow" />
            </div>
          </div>

          {/* Heading */}
          <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-3">
            Generating Map Layers
          </h3>
          
          {/* Dynamic Status message */}
          <div className="h-12 flex items-center justify-center mb-6">
            <p className="text-slate-600 dark:text-slate-350 font-medium transition-all duration-350 animate-pulse">
              {loadingMessages[loadingStep]}
            </p>
          </div>

          {/* Progress Bar indicator */}
          <div className="w-64 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-2">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500 ease-out" 
              style={{ width: `${((loadingStep + 1) / loadingMessages.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Step {loadingStep + 1} of {loadingMessages.length}
          </span>
        </div>
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center glass-panel rounded-2xl shadow-xl border border-slate-200/50 dark:border-slate-800/50 animate-fade-in">
        <div className="flex flex-col items-center justify-center py-10">
          <Compass className="h-16 w-16 text-slate-400 dark:text-slate-500 mb-4 animate-pulse" />
          <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">No Addresses Found</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md">
            We couldn't locate any matching addresses in Berlin. Please double check the address name and try a different search term.
          </p>
        </div>
      </div>
    );
  }

  const currentAddress = addresses[currentIndex.index];

  return (
    <div className="p-6 max-w-2xl mx-auto animate-fade-in">
      {/* Title & Info Section */}
      <div className="mb-6 text-center md:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-3 border border-emerald-500/25">
          <Compass size={14} className="animate-spin-slow" />
          Address Results Located
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
          Select Location
        </h2>
        <p className="text-slate-600 dark:text-slate-400 text-sm max-w-lg">
          We found {addresses.length} possible matching location(s) in Berlin. Browse the cards below and select one to fetch map overlays.
        </p>
      </div>

      {/* Main Address Card (Glassmorphic) */}
      <div className="glass-panel border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 hover:shadow-emerald-500/5">
        <div className="p-6 md:p-8">
          {/* Carousel Header Controls */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200/50 dark:border-slate-800/50">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-350">
                {currentIndex.index + 1}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                of {addresses.length} results
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrevious}
                disabled={addresses.length <= 1}
                className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
                title="Previous address"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={handleNext}
                disabled={addresses.length <= 1}
                className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
                title="Next address"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Card Body - Address Information */}
          <div className="space-y-6">
            <div className="flex gap-3 items-start">
              <div className="p-2 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 mt-1 flex-shrink-0 animate-pulse-glow">
                <MapPin size={22} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-855 dark:text-white leading-tight mb-2">
                  {currentAddress.display_name}
                </h3>
                {currentAddress.address.postcode && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    PLZ {currentAddress.address.postcode} • {currentAddress.address.city || "Berlin"}
                  </span>
                )}
              </div>
            </div>

            {/* Meta Information Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/40 text-sm">
              <div className="p-3.5 rounded-xl bg-slate-50/50 dark:bg-slate-900/35 border border-slate-100 dark:border-slate-800/30">
                <span className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
                  Coordinates (WGS84)
                </span>
                <span className="font-mono text-slate-700 dark:text-slate-300 break-all">
                  {parseFloat(currentAddress.lat).toFixed(6)}, {parseFloat(currentAddress.lon).toFixed(6)}
                </span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50/50 dark:bg-slate-900/35 border border-slate-100 dark:border-slate-800/30">
                <span className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
                  Location Type
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">
                  {currentAddress.addresstype || currentAddress.class || "Unknown"}
                </span>
              </div>
            </div>

            {/* Select Button */}
            <button
              onClick={() => handleSelect(currentAddress)}
              className="w-full py-4 px-6 bg-gradient-to-r from-emerald-500 to-teal-650 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-600/30 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer group"
            >
              <Navigation size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              Select & Fetch Maps →
            </button>
          </div>
        </div>

        {/* Carousel Bottom Dot Navigation */}
        <div className="bg-slate-50/50 dark:bg-slate-900/30 px-6 py-4 border-t border-slate-200/50 dark:border-slate-850/50 flex justify-center items-center">
          <div className="flex gap-2 max-w-full overflow-x-auto py-1 scrollbar-none">
            {addresses.map((_: any, idx: number) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex({ index: idx })}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-350 cursor-pointer ${
                  idx === currentIndex.index 
                    ? 'bg-emerald-500 w-6 scale-110 shadow-sm shadow-emerald-500/50' 
                    : 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Modern Tips Card */}
      <div className="mt-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/40 dark:border-slate-800/40 flex gap-3 text-sm animate-fade-in">
        <Info className="h-5 w-5 text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
        <div className="text-slate-600 dark:text-slate-400">
          <p className="font-bold text-slate-850 dark:text-slate-200 mb-1">Navigation Tips:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Use the left/right arrows in the header to page through location options.</li>
            <li>Click directly on the slide dots at the bottom to jump to a specific index.</li>
            <li>Clicking "Select & Fetch Maps" will automatically retrieve the official Berlin property value (Bodenrichtwert) map.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
