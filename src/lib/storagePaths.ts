import { supabase } from "@/integrations/supabase/client";

// Bucket names
const CLIENT_FILES_BUCKET = 'client-files';
const APP_ASSETS_BUCKET = 'app-assets';

// South African provinces for tariff organization
const SA_PROVINCES = [
  { pattern: /Eastern\s*Cape/i, name: 'Eastern Cape' },
  { pattern: /Free\s*State/i, name: 'Free State' },
  { pattern: /Western\s*Cape/i, name: 'Western Cape' },
  { pattern: /Northern\s*Cape/i, name: 'Northern Cape' },
  { pattern: /Gauteng/i, name: 'Gauteng' },
  { pattern: /KwaZulu[-\s]*Natal|KZN/i, name: 'KwaZulu-Natal' },
  { pattern: /Limpopo/i, name: 'Limpopo' },
  { pattern: /Mpumalanga/i, name: 'Mpumalanga' },
  { pattern: /North[-\s]*West/i, name: 'North West' },
];

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

/**
 * Infer province from filename using South African province patterns
 * 
 * @param filename - The filename to extract province from
 * @returns The province name or 'Unknown' if not found
 */
export const inferProvinceFromFilename = (filename: string): string => {
  for (const province of SA_PROVINCES) {
    if (province.pattern.test(filename)) {
      return province.name;
    }
  }
  return 'Unknown';
};

/**
 * Generate temporary tariff extraction path (before municipality is known)
 * Pattern: Tariffs/_temp/tariff-extract-{timestamp}.png
 * 
 * @param timestamp - The timestamp for unique identification
 * @returns Object with bucket name and path
 */
export const generateTempTariffExtractPath = (
  timestamp: number
): { bucket: string; path: string } => {
  return {
    bucket: CLIENT_FILES_BUCKET,
    path: `Tariffs/_temp/tariff-extract-${timestamp}.png`
  };
};

/**
 * Generate tariff extraction storage path
 * Pattern: Tariffs/{Province}/{Municipality}/{Municipality}-tariff-extract-{timestamp}.png
 * 
 * @param province - The province name (e.g., "Gauteng", "KwaZulu-Natal")
 * @param municipalityName - The municipality name
 * @param timestamp - The timestamp for unique identification
 * @returns Object with bucket name and path
 */
export const generateTariffExtractPath = (
  province: string,
  municipalityName: string,
  timestamp: number
): { bucket: string; path: string } => {
  const sanitizedProvince = sanitizeName(province || 'Unknown');
  const sanitizedMunicipality = sanitizeName(municipalityName);
  const fileName = `${sanitizedMunicipality}-tariff-extract-${timestamp}.png`;
  return {
    bucket: CLIENT_FILES_BUCKET,
    path: `Tariffs/${sanitizedProvince}/${sanitizedMunicipality}/${fileName}`
  };
};

/**
 * Move a tariff extract from temp location to final structured location
 * Downloads from temp, uploads to final location, deletes temp file
 * 
 * @param tempPath - The temporary path (without bucket prefix)
 * @param province - The province name
 * @param municipalityName - The municipality name
 * @param timestamp - The timestamp used in the filename
 * @returns The new public URL
 */
export const moveTariffExtractToFinalLocation = async (
  tempPath: string,
  province: string,
  municipalityName: string,
  timestamp: number
): Promise<string> => {
  const { bucket, path: newPath } = generateTariffExtractPath(province, municipalityName, timestamp);
  
  // Download from temp
  const { data: fileData, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(tempPath);
  
  if (downloadError) {
    console.error('Failed to download temp file:', downloadError);
    throw downloadError;
  }
  
  // Upload to new location
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(newPath, fileData, { contentType: 'image/png', upsert: true });
  
  if (uploadError) {
    console.error('Failed to upload to final location:', uploadError);
    throw uploadError;
  }
  
  // Delete temp file (don't throw if this fails)
  const { error: deleteError } = await supabase.storage.from(bucket).remove([tempPath]);
  if (deleteError) {
    console.warn('Failed to delete temp file:', deleteError);
  }
  
  // Return new public URL
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(newPath);
  return publicUrl;
};
