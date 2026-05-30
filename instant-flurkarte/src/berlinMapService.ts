import axios from 'axios';
import proj4 from 'proj4';

// 1. Nominatim geocoding API response type definition
interface NominatimResponse {
    lat: string;
    lon: string;
    display_name: string;
    [key: string]: any; 
}

// 2. Coordinate system definition (WGS84 lat/lon <-> Berlin official EPSG:25833 UTM meters)
const WGS84 = 'EPSG:4326';
const BERLIN_UTM = '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

/**
 * Search for multiple address candidates based on text address.
 * @param address Address to search
 * @param limit Maximum number of results to return (default: 10)
 */
export async function searchAddresses(address: string, limit: number = 10): Promise<NominatimResponse[]> {
    console.log(`[Address Search] Starting search for "${address}"...`);
    
    const geocodeUrl = 'https://nominatim.openstreetmap.org/search';
    
    try {
        const response = await axios.get<NominatimResponse[]>(geocodeUrl, {
            params: {
                q: address,
                format: 'json',
                limit: limit,
                addressdetails: 1,
                countrycodes: 'de' // Search only within Germany
            },
            headers: { 
                'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
            },
            timeout: 10000 // 10 second timeout
        });

        if (!response.data || response.data.length === 0) {
            throw new Error(`No addresses found for: ${address}. Try a different search term or check if the address exists in Germany.`);
        }

        console.log(`-> Found ${response.data.length} address(es)`);
        return response.data;
    } catch (error: any) {
        if (error.code === 'ECONNABORTED') {
            throw new Error('Address search timeout. Please try again.');
        } else if (error.response?.status === 429) {
            throw new Error('Too many requests. Please wait a moment and try again.');
        } else if (error.response?.status === 403) {
            throw new Error('Access denied. Please check your User-Agent configuration.');
        } else if (error.response?.status === 500) {
            throw new Error('Nominatim service error. Please try again later.');
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error('Network error. Please check your internet connection.');
        } else {
            console.error('[Address Search Error]', error.message);
            throw new Error(`Failed to search for addresses: ${error.message}`);
        }
    }
}

/**
 * Generate BBOX (area boundary) string compliant with Berlin WMS format from text address.
 * @param address Berlin address to search
 * @param radiusInMeters Distance to extend in all directions from center point in meters (default: 75m -> 150m x 150m area)
 */
async function getBboxFromAddress(address: string, radiusInMeters: number = 75): Promise<string> {
    console.log(`[Step 1] Starting address coordinate conversion: "${address}"`);
    
    const geocodeUrl = 'https://nominatim.openstreetmap.org/search';
    
    const response = await axios.get<NominatimResponse[]>(geocodeUrl, {
        params: {
            q: address,
            format: 'json',
            limit: 1
        },
        headers: { 
            // Unique User-Agent setting is required by open source API policy.
            'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
        }
    });

    if (!response.data || response.data.length === 0) {
        throw new Error(`Address not found: ${address}`);
    }

    const location = response.data[0];
    const lat = parseFloat(location.lat);
    const lon = parseFloat(location.lon);
    console.log(`-> Lat/lon conversion successful: Lat ${lat}, Lon ${lon}`);

    // Convert lat/lon ([lon, lat]) to Berlin meter coordinates ([X, Y])
    // proj4 receives arrays in [longitude, latitude] i.e. [X, Y] order by default.
    const [utmX, utmY] = proj4(WGS84, BERLIN_UTM, [lon, lat]) as [number, number];
    console.log(`-> Berlin UTM coordinate conversion: X=${utmX.toFixed(2)}, Y=${utmY.toFixed(2)}`);

    // Calculate rectangular (BBOX) boundary based on center point
    const minX = (utmX - radiusInMeters).toFixed(2);
    const minY = (utmY - radiusInMeters).toFixed(2);
    const maxX = (utmX + radiusInMeters).toFixed(2);
    const maxY = (utmY + radiusInMeters).toFixed(2);

    // Return WMS format string (West, South, East, North)
    return `${minX},${minY},${maxX},${maxY}`;
}

/**
 * Query property value data for a specific address using WMS GetFeatureInfo.
 * @param address Berlin address to search
 * @param layer Layer name to query. Options: 'brw2026', 'brw2025'. Default: 'brw2026'
 */
export async function getPropertyValueData(address: string, layer: string = 'brw2026'): Promise<string> {
    try {
        console.log(`[Property Value Query] Starting query for "${address}"...`);
        
        // Get coordinates for the address
        const geocodeUrl = 'https://nominatim.openstreetmap.org/search';
        const response = await axios.get<NominatimResponse[]>(geocodeUrl, {
            params: {
                q: address,
                format: 'json',
                limit: 1
            },
            headers: { 
                'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
            }
        });

        if (!response.data || response.data.length === 0) {
            throw new Error(`Address not found: ${address}`);
        }

        const location = response.data[0];
        const lat = parseFloat(location.lat);
        const lon = parseFloat(location.lon);
        
        // Select WMS endpoint based on layer
        const wmsEndpoints: { [key: string]: string } = {
            'brw2026': 'https://gdi.berlin.de/services/wms/brw2026',
            'brw2025': 'https://gdi.berlin.de/services/wms/brw2025'
        };
        const wmsUrl = wmsEndpoints[layer] || wmsEndpoints['brw2026'];
        
        // GetFeatureInfo request to query property value at the point
        const params = {
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetFeatureInfo',
            LAYERS: layer,
            QUERY_LAYERS: layer,
            INFO_FORMAT: 'application/json',
            CRS: 'EPSG:25833',
            BBOX: `${lon-0.001},${lat-0.001},${lon+0.001},${lat+0.001}`,
            WIDTH: '100',
            HEIGHT: '100',
            I: '50', // X coordinate in pixels
            J: '50'  // Y coordinate in pixels
        };

        console.log(`[Property Value Query] WMS URL: ${wmsUrl}`);
        
        const featureResponse = await axios.get(wmsUrl, {
            params: params,
            timeout: 10000,
            headers: { 
                'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
            }
        });

        console.log(`[Property Value Query] Response received`);
        
        if (featureResponse.data && featureResponse.data.features && featureResponse.data.features.length > 0) {
            const feature = featureResponse.data.features[0];
            const properties = feature.properties;
            
            let result = `Property Value Data for: ${address}\n`;
            result += `Coordinates: ${lat.toFixed(6)}, ${lon.toFixed(6)}\n\n`;
            
            for (const [key, value] of Object.entries(properties)) {
                result += `${key}: ${value}\n`;
            }
            
            return result;
        } else {
            return `No property value data found for this location. The address may be outside the coverage area of the property value database.`;
        }

    } catch (error: any) {
        console.error('[Property Value Query Error]', error.message);
        if (error.response?.status === 404) {
            return 'Property value data not available for this location.';
        } else if (error.code === 'ECONNABORTED') {
            return 'Property value query timeout. Please try again.';
        } else {
            return `Failed to query property value data: ${error.message}`;
        }
    }
}

/**
 * Return Berlin Flurkarte (cadastral) WMS map as Base64 data URL based on address.
 * @param address Berlin address to search
 * @param zoomLevel Zoom level (1-10, where 1 is closest zoom, 10 is furthest). Default: 5
 */
export async function getFlurkarteAsBase64(address: string, zoomLevel: number = 1): Promise<string> {
    try {
        // Convert zoom level (1-10) to radius in meters
        // Level 1 = closest (25m radius), Level 10 = furthest (500m radius)
        const zoomRadiusMap: { [key: number]: number } = {
            1: 25,
            2: 50,
            3: 75,
            4: 100,
            5: 150,
            6: 200,
            7: 300,
            8: 400,
            9: 500,
            10: 750
        };
        
        const radius = zoomRadiusMap[zoomLevel] || 150; // Default to 150m if invalid zoom level
        
        // Convert address to BBOX with calculated radius
        const bbox = await getBboxFromAddress(address, radius);

        console.log(`[Flurkarte] Starting Berlin ALKIS WMS server image request...`);
        
        // ALKIS Flurstücke WMS endpoint for Berlin cadastral maps
        // const wmsUrl = 'https://gdi.berlin.de/services/wms/alkis_flurstuecke';
        // // const wmsUrl = 'https://gdi.berlin.de/wms/k5_schwarz';
        
        // const params = {
        //     SERVICE: 'WMS',
        //     VERSION: '1.3.0',
        //     REQUEST: 'GetMap',
        //     LAYERS: 'flurstuecke',
        //     // LAYERS: 'k5_schwarz',
        //     STYLES: '',
        //     CRS: 'EPSG:25833',  // Berlin official coordinate system setting
        //     BBOX: bbox,
        //     WIDTH: '1200',       // Image width in pixels
        //     HEIGHT: '900',      // Image height in pixels
        //     FORMAT: 'image/png',
        //     TRANSPARENT: 'FALSE'
        // };

        const wmsUrl = 'https://sgx.geodatenzentrum.de/wms_basemapde';

        const params = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": "de_basemapde_web_raster_grau",
            "STYLES": "",
            "CRS": "EPSG:25833",
            "BBOX": bbox,
            "WIDTH": "750",
            "HEIGHT": "750",
            "FORMAT": "image/png",
            "TRANSPARENT": "FALSE"
        }

        console.log(`[Flurkarte WMS Request Parameters] URL: ${wmsUrl}`);
        console.log(`[Flurkarte WMS Request Parameters] BBOX: ${bbox}`);
        console.log(`[Flurkarte WMS Request Parameters] Full parameters:`, JSON.stringify(params, null, 2));

        const response = await axios({
            method: 'GET',
            url: wmsUrl,
            params: params,
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout for map download
        });

        console.log(`[Flurkarte WMS Response] Status code: ${response.status}`);
        console.log(`[Flurkarte WMS Response] Content-Type: ${response.headers['content-type']}`);

        // Check if response is an error (XML error response from WMS)
        const contentType = response.headers['content-type'];
        const contentTypeStr = typeof contentType === 'string' ? contentType : String(contentType);
        if (contentTypeStr.includes('xml') || contentTypeStr.includes('text/xml')) {
            const errorText = Buffer.from(response.data).toString('utf-8');
            console.error(`[Flurkarte WMS Error] XML Error Response:`, errorText);
            
            // Parse common WMS error messages
            if (errorText.includes('LayerNotDefined')) {
                throw new Error('Flurkarte layer not available. The cadastral map layer may be temporarily unavailable.');
            } else if (errorText.includes('InvalidSRS')) {
                throw new Error('Coordinate system error. Please try again.');
            } else if (errorText.includes('InvalidBBOX')) {
                throw new Error('Invalid map area. The address may be outside the available coverage area.');
            } else {
                throw new Error('Flurkarte service error. Please try again later.');
            }
        }

        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        const dataUrl = `data:image/png;base64,${base64Image}`;
        
        console.log(`🎉 Flurkarte Base64 conversion complete (size: ${base64Image.length} characters)`);
        return dataUrl;

    } catch (error: any) {
        console.error('Error during Flurkarte download process:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            throw new Error('Flurkarte download timeout. The server may be slow. Please try again.');
        } else if (error.response?.status === 404) {
            throw new Error('Flurkarte service not found. The WMS endpoint may have changed.');
        } else if (error.response?.status === 500) {
            throw new Error('Flurkarte service error. Please try again later.');
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error('Network error. Please check your internet connection.');
        } else if (error.message.includes('LayerNotDefined') || error.message.includes('layer')) {
            throw new Error('Flurkarte layer not available. This may be a temporary service issue.');
        } else if (error.message.includes('InvalidBBOX') || error.message.includes('coverage')) {
            throw new Error('Address outside available coverage area. The Flurkarte may not be available for this location.');
        } else {
            // Re-throw custom errors
            if (error.message.includes('Flurkarte service') || error.message.includes('layer') || error.message.includes('timeout')) {
                throw error;
            }
            throw new Error(`Failed to retrieve Flurkarte: ${error.message}`);
        }
    }
}

/**
 * Return Berlin Bodenrichtwert (property value) WMS map as Base64 data URL based on address.
 * @param address Berlin address to search
 * @param zoomLevel Zoom level (1-10, where 1 is closest zoom, 10 is furthest). Default: 5
 * @param layer Layer name to display. Options: 'brw2026' (2026 property values), 'brw2025' (2025 property values). Default: 'brw2026'
 */
export async function getBerlinMapAsBase64(address: string, zoomLevel: number = 5, layer: string = 'brw2026'): Promise<string> {
    try {
        // Convert zoom level (1-10) to radius in meters
        // Level 1 = closest (25m radius), Level 10 = furthest (500m radius)
        const zoomRadiusMap: { [key: number]: number } = {
            1: 25,
            2: 50,
            3: 75,
            4: 100,
            5: 150,
            6: 200,
            7: 300,
            8: 400,
            9: 500,
            10: 750
        };
        
        const radius = zoomRadiusMap[zoomLevel] || 150; // Default to 150m if invalid zoom level
        
        // Convert address to BBOX with calculated radius
        const bbox = await getBboxFromAddress(address, radius);

        console.log(`[Step 2] Starting Berlin WMS server image request...`);
        
        // Select WMS endpoint based on layer
        const wmsEndpoints: { [key: string]: string } = {
            'brw2026': 'https://gdi.berlin.de/services/wms/brw2026',
            'brw2025': 'https://gdi.berlin.de/services/wms/brw2025'
        };
        const wmsUrl = wmsEndpoints[layer] || wmsEndpoints['brw2026'];
        
        const params = {
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetMap',
            LAYERS: layer, // Use the selected layer
            STYLES: '',
            CRS: 'EPSG:25833',  // Berlin official coordinate system setting
            BBOX: bbox,
            WIDTH: '400',       // Image width in pixels (reduced from 800)
            HEIGHT: '300',      // Image height in pixels (reduced from 600)
            FORMAT: 'image/png',
            TRANSPARENT: 'TRUE'
        };

        console.log(`[WMS Request Parameters] URL: ${wmsUrl}`);
        console.log(`[WMS Request Parameters] BBOX: ${bbox}`);
        console.log(`[WMS Request Parameters] Full parameters:`, JSON.stringify(params, null, 2));

        const response = await axios({
            method: 'GET',
            url: wmsUrl,
            params: params,
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout for map download
        });

        console.log(`[WMS Response] Status code: ${response.status}`);
        console.log(`[WMS Response] Content-Type: ${response.headers['content-type']}`);

        // Check if response is an error (XML error response from WMS)
        const contentType = response.headers['content-type'];
        const contentTypeStr = typeof contentType === 'string' ? contentType : String(contentType);
        if (contentTypeStr.includes('xml') || contentTypeStr.includes('text/xml')) {
            const errorText = Buffer.from(response.data).toString('utf-8');
            console.error(`[WMS Error] XML Error Response:`, errorText);
            
            // Parse common WMS error messages
            if (errorText.includes('LayerNotDefined')) {
                throw new Error('Map layer not available. The property value layer may be temporarily unavailable.');
            } else if (errorText.includes('InvalidSRS')) {
                throw new Error('Coordinate system error. Please try again.');
            } else if (errorText.includes('InvalidBBOX')) {
                throw new Error('Invalid map area. The address may be outside the available coverage area.');
            } else {
                throw new Error('Map service error. Please try again later.');
            }
        }

        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        const dataUrl = `data:image/png;base64,${base64Image}`;
        
        console.log(`🎉 Map Base64 conversion complete (size: ${base64Image.length} characters)`);
        return dataUrl;

    } catch (error: any) {
        console.error('Error during map download process:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            throw new Error('Map download timeout. The server may be slow. Please try again.');
        } else if (error.response?.status === 404) {
            throw new Error('Map service not found. The WMS endpoint may have changed.');
        } else if (error.response?.status === 500) {
            throw new Error('Map service error. Please try again later.');
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error('Network error. Please check your internet connection.');
        } else if (error.message.includes('LayerNotDefined') || error.message.includes('layer')) {
            throw new Error('Property value layer not available. This may be a temporary service issue.');
        } else if (error.message.includes('InvalidBBOX') || error.message.includes('coverage')) {
            throw new Error('Address outside available coverage area. The property value map may not be available for this location.');
        } else {
            // Re-throw custom errors
            if (error.message.includes('Map service') || error.message.includes('layer') || error.message.includes('timeout')) {
                throw error;
            }
            throw new Error(`Failed to retrieve map: ${error.message}`);
        }
    }
}
