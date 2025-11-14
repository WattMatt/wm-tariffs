import { supabase } from "@/integrations/supabase/client";

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
 * Generate hierarchical storage path
 * Pattern: {Client}/{Site}/{Section}/{SubPath}/{FileName}
 * 
 * @param siteId - The UUID of the site
 * @param section - Top-level section (Metering, Documents, Tariffs, Reconciliation)
 * @param subPath - Sub-path within the section (e.g., "Schematics", "Meters/M123")
 * @param fileName - The file name
 * @returns Full hierarchical path
 */
export const generateStoragePath = async (
  siteId: string,
  section: 'Metering' | 'Documents' | 'Tariffs' | 'Reconciliation',
  subPath: string,
  fileName: string
): Promise<string> => {
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
  
  return `${clientName}/${siteName}/${section}/${subPath}/${fileName}`;
};

/**
 * Generate meter-specific storage path
 * Pattern: {Client}/{Site}/Metering/Meters/{MeterNumber}/{SubPath}/{FileName}
 * 
 * @param siteId - The UUID of the site
 * @param meterNumber - The meter number
 * @param subPath - Sub-path within the meter folder (e.g., "Snippets", or empty for root)
 * @param fileName - The file name
 * @returns Full hierarchical path
 */
export const generateMeterStoragePath = async (
  siteId: string,
  meterNumber: string,
  subPath: string,
  fileName: string
): Promise<string> => {
  const sanitizedMeterNumber = sanitizeName(meterNumber);
  const meterPath = subPath ? `Meters/${sanitizedMeterNumber}/${subPath}` : `Meters/${sanitizedMeterNumber}`;
  return generateStoragePath(siteId, 'Metering', meterPath, fileName);
};
