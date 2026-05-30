#!/usr/bin/env tsx
/**
 * Validation script for Berlin Flurkarte parcel identification
 * Usage: npx tsx scripts/validate-parcel.ts "Wollankstraße 82, Berlin"
 */

import { getFlurkarteResult } from '../src/berlinMapService.js';

async function validateParcel(address: string) {
    console.log('='.repeat(70));
    console.log('Berlin Flurkarte Parcel Validation');
    console.log('='.repeat(70));
    console.log(`\nAddress:             ${address}`);
    
    try {
        const result = await getFlurkarteResult(address, 1);
        
        // Extract coordinates from the address geocoding (we need to re-geocode to show them)
        const axios = (await import('axios')).default;
        const proj4 = (await import('proj4')).default;
        
        const WGS84 = 'EPSG:4326';
        const BERLIN_UTM = '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
        
        const geocodeUrl = 'https://nominatim.openstreetmap.org/search';
        const geocodeResponse = await axios.get(geocodeUrl, {
            params: {
                q: address,
                format: 'json',
                limit: 1
            },
            headers: { 
                'User-Agent': 'SkybridgeBerlinMapAgent/1.0.0 (contact@yourdomain.com)' 
            }
        });

        if (geocodeResponse.data && geocodeResponse.data.length > 0) {
            const location = geocodeResponse.data[0];
            const lat = parseFloat(location.lat);
            const lon = parseFloat(location.lon);
            const [utmX, utmY] = proj4(WGS84, BERLIN_UTM, [lon, lat]) as [number, number];
            
            console.log(`Geocoded point:      (${utmX.toFixed(2)}, ${utmY.toFixed(2)}) EPSG:25833`);
        }
        
        console.log(`Flurstueckskennzeichen: ${result.flurstueckskennzeichen || 'N/A'}`);
        console.log(`Confidence:          ${result.confidence}`);
        
        if (result.warning) {
            console.log(`Warning:             ${result.warning}`);
        }
        
        console.log(`\nSource:              ${result.source}`);
        console.log(`Extracted at:        ${result.extractedAt}`);
        
        // Validation checks
        console.log('\n' + '='.repeat(70));
        console.log('Validation Checks');
        console.log('='.repeat(70));
        
        if (result.confidence === 'containing') {
            console.log('✓ Point-in-parcel:     yes (geocoded point lies inside parcel polygon)');
        } else if (result.confidence === 'approximate') {
            console.log('✗ Point-in-parcel:     no (using nearest parcel)');
        } else {
            console.log('? Point-in-parcel:     unknown');
        }
        
        // Note: Berlin ALKIS WFS doesn't provide lagebeztxt for exact address matching
        console.log('✓ House number match:  N/A (Berlin ALKIS WFS does not provide address field)');
        
        console.log('\n' + '='.repeat(70));
        
        if (result.confidence === 'containing') {
            console.log('✓ VALIDATION PASSED: Parcel identification successful');
            process.exit(0);
        } else if (result.confidence === 'approximate') {
            console.log('⚠ VALIDATION WARNING: Approximate match - please verify manually');
            process.exit(1);
        } else {
            console.log('✗ VALIDATION FAILED: Could not identify parcel');
            process.exit(2);
        }
        
    } catch (error: any) {
        console.error(`\n✗ Error: ${error.message}`);
        process.exit(2);
    }
}

// Get address from command line argument
const address = process.argv[2];

if (!address) {
    console.error('Usage: npx tsx scripts/validate-parcel.ts "Address, Berlin"');
    console.error('Example: npx tsx scripts/validate-parcel.ts "Wollankstraße 82, Berlin"');
    process.exit(1);
}

validateParcel(address);
