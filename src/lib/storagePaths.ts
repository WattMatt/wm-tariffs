import { supabase } from "@/integrations/supabase/client";

// Bucket names
const CLIENT_FILES_BUCKET = 'client-files';
const APP_ASSETS_BUCKET = 'app-assets';

/**
 * Sanitize folder/file names for storage
 * Removes special characters and normalizes spaces
 */
export const sanitizeName = (name: string): string => {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special chars except space, dash, underscore
    .replace(/\s+/g, ' '); // Normalize spaces
};

/**
 * Generate hierarchical storage path in client-files bucket
 * Pattern: {Client}/{Site}/{Section}/{SubPath}/{FileName}
 * 
 * @param siteId - The UUID of the site
 * @param section - Top-level section (Metering, Documents, Tariffs, Reconciliation)
 * @param subPath - Sub-path within the section (e.g., "Schematics", "Meters/M123")
 * @param fileName - The file name
 * @returns Object with bucket name and full hierarchical path
 */
export const generateStoragePath = async (
  siteId: string,
  section: 'Metering' | 'Documents' | 'Tariffs' | 'Reconciliation',
  subPath: string,
  fileName: string
): Promise<{ bucket: string; path: string }> => {
  // Fetch client and site data
  const { data: siteData, error } = await supabase
    .from('sites')
    .select('name, clients(name)')
    .eq('id', siteId)
    .single();
  
  if (error || !siteData) {
    console.error('Error fetching site data for path generation:', error);
    throw new Error('Site not found');
  }
  
  const clientName = sanitizeName((siteData.clients as any).name);
  const siteName = sanitizeName(siteData.name);
  
  return {
    bucket: CLIENT_FILES_BUCKET,
    path: `${clientName}/${siteName}/${section}/${subPath}/${fileName}`
  };
};

/**
 * Generate meter-specific storage path
 * Pattern: {Client}/{Site}/Metering/Meters/{MeterNumber}/{SubPath}/{FileName}
 * 
 * @param siteId - The UUID of the site
 * @param meterNumber - The meter number
 * @param subPath - Sub-path within the meter folder (e.g., "Snippets", "CSVs", or empty for root)
 * @param fileName - The file name
 * @returns Object with bucket name and full hierarchical path
 */
export const generateMeterStoragePath = async (
  siteId: string,
  meterNumber: string,
  subPath: string,
  fileName: string
): Promise<{ bucket: string; path: string }> => {
  const sanitizedMeterNumber = sanitizeName(meterNumber);
  const meterPath = subPath ? `Meters/${sanitizedMeterNumber}/${subPath}` : `Meters/${sanitizedMeterNumber}`;
  return generateStoragePath(siteId, 'Metering', meterPath, fileName);
};

/**
 * Generate client logo storage path
 * Pattern: {ClientName}/Logo/{FileName}
 * 
 * @param clientName - The name of the client
 * @param fileName - The file name
 * @returns Object with bucket name and path
 */
export const generateClientLogoPath = (clientName: string, fileName: string): { bucket: string; path: string } => {
  const sanitizedClientName = sanitizeName(clientName);
  return {
    bucket: CLIENT_FILES_BUCKET,
    path: `${sanitizedClientName}/Logo/${fileName}`
  };
};

/**
 * Generate app asset storage path (for global assets like app logo)
 * Pattern: {AssetType}/{FileName}
 * 
 * @param assetType - The type of asset (e.g., "Logos")
 * @param fileName - The file name
 * @returns Object with bucket name and path
 */
export const generateAppAssetPath = (assetType: string, fileName: string): { bucket: string; path: string } => {
  return {
    bucket: APP_ASSETS_BUCKET,
    path: `${assetType}/${fileName}`
  };
};
