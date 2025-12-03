import { supabase } from '@/integrations/supabase/client';
import type { DateRange, DocumentDateRange, HierarchicalCsvResult, MeterConnection } from './types';

/**
 * Fetch overall date range for all meters in a site
 */
export async function fetchDateRanges(siteId: string): Promise<DateRange> {
  // Get all meter IDs for this site first
  const { data: meterIds } = await supabase
    .from("meters")
    .select("id")
    .eq("site_id", siteId);
  
  if (!meterIds || meterIds.length === 0) {
    return { earliest: null, latest: null };
  }
  
  const ids = meterIds.map(m => m.id);
  
  // Get earliest reading across all site meters
  const { data: earliestData } = await supabase
    .from("meter_readings")
    .select("reading_timestamp")
    .in("meter_id", ids)
    .order("reading_timestamp", { ascending: true })
    .limit(1);
  
  // Get latest reading across all site meters
  const { data: latestData } = await supabase
    .from("meter_readings")
    .select("reading_timestamp")
    .in("meter_id", ids)
    .order("reading_timestamp", { ascending: false })
    .limit(1);
  
  const earliest = earliestData?.[0] ? new Date(earliestData[0].reading_timestamp) : null;
  const latest = latestData?.[0] ? new Date(latestData[0].reading_timestamp) : null;
  
  return { earliest, latest };
}

/**
 * Fetch basic meter list for a site (no hierarchy, no data checks)
 */
export async function fetchBasicMeters(siteId: string) {
  const { data: meters, error } = await supabase
    .from("meters")
    .select("id, meter_number, meter_type, tariff_structure_id")
    .eq("site_id", siteId)
    .order("meter_number");
  
  if (error) {
    console.error("Error fetching meters:", error);
    return [];
  }
  
  return meters || [];
}

/**
 * Fetch document date ranges for municipal accounts and tenant bills
 */
export async function fetchDocumentDateRanges(siteId: string): Promise<DocumentDateRange[]> {
  const { data, error } = await supabase
    .from('site_documents')
    .select(`
      id,
      document_type,
      file_name,
      document_extractions (
        period_start,
        period_end
      )
    `)
    .eq('site_id', siteId)
    .in('document_type', ['municipal_account', 'tenant_bill'])
    .not('document_extractions.period_start', 'is', null)
    .not('document_extractions.period_end', 'is', null);

  if (error) {
    console.error("Error fetching document date ranges:", error);
    return [];
  }

  if (!data) return [];

  return data
    .filter(doc => doc.document_extractions && doc.document_extractions.length > 0)
    .map(doc => ({
      id: doc.id,
      document_type: doc.document_type,
      file_name: doc.file_name,
      period_start: doc.document_extractions[0].period_start,
      period_end: doc.document_extractions[0].period_end,
    }))
    .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());
}

/**
 * Fetch hierarchical data from hierarchical_meter_readings table
 */
export async function fetchHierarchicalDataFromReadings(
  meterIds: string[],
  dateFrom: string,
  dateTo: string,
  columnOperations?: Map<string, string>
): Promise<Map<string, HierarchicalCsvResult>> {
  const results = new Map<string, HierarchicalCsvResult>();
  const pageSize = 1000;
  
  for (const meterId of meterIds) {
    let allReadings: any[] = [];
    let start = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageData } = await supabase
        .from('hierarchical_meter_readings')
        .select('kwh_value, kva_value, metadata')
        .eq('meter_id', meterId)
        .gte('reading_timestamp', dateFrom)
        .lte('reading_timestamp', dateTo)
        .eq('metadata->>source', 'hierarchical_aggregation')
        .order('reading_timestamp', { ascending: true })
        .range(start, start + pageSize - 1);
      
      if (pageData && pageData.length > 0) {
        allReadings = allReadings.concat(pageData);
        start += pageSize;
        hasMore = pageData.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    
    if (allReadings.length > 0) {
      let totalKwh = 0;
      const columnTotals: Record<string, number> = {};
      const columnMaxValues: Record<string, number> = {};
      
      allReadings.forEach(r => {
        totalKwh += r.kwh_value || 0;
        const metadata = r.metadata as any;
        const imported = metadata?.imported_fields || {};
        Object.entries(imported).forEach(([key, value]) => {
          const numValue = Number(value) || 0;
          const operation = columnOperations?.get(key) || 'sum';
          
          if (operation === 'max') {
            columnMaxValues[key] = Math.max(columnMaxValues[key] || 0, numValue);
          } else {
            columnTotals[key] = (columnTotals[key] || 0) + numValue;
          }
        });
      });
      
      results.set(meterId, {
        totalKwh,
        columnTotals,
        columnMaxValues,
        rowCount: allReadings.length
      });
    }
  }
  
  return results;
}

/**
 * Fetch CSV files info for meters
 */
export async function fetchMeterCsvFilesInfo(meterIds: string[]): Promise<Map<string, { parsed?: string; generated?: string }>> {
  if (meterIds.length === 0) return new Map();
  
  const { data, error } = await supabase
    .from('meter_csv_files')
    .select('meter_id, file_path, parse_status')
    .in('meter_id', meterIds)
    .in('parse_status', ['parsed', 'generated']);
  
  if (error || !data) {
    console.error('Error fetching CSV files info:', error);
    return new Map();
  }
  
  const map = new Map<string, { parsed?: string; generated?: string }>();
  data.forEach(file => {
    const existing = map.get(file.meter_id) || {};
    if (file.parse_status === 'parsed') {
      existing.parsed = file.file_path;
    } else if (file.parse_status === 'generated') {
      existing.generated = file.file_path;
    }
    map.set(file.meter_id, existing);
  });
  
  return map;
}

/**
 * Check existing hierarchical CSV coverage in database
 */
export async function checkHierarchicalCsvCoverage(
  parentMeterIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<Map<string, boolean>> {
  if (parentMeterIds.length === 0) return new Map();

  const { data: existingCsvs } = await supabase
    .from('meter_csv_files')
    .select('meter_id, generated_date_from, generated_date_to, parse_status')
    .in('meter_id', parentMeterIds)
    .ilike('file_name', '%Hierarchical%');

  const coverageMap = new Map<string, boolean>();
  
  for (const meterId of parentMeterIds) {
    const csv = existingCsvs?.find(c => 
      c.meter_id === meterId && 
      (c.parse_status === 'parsed' || c.parse_status === 'pending')
    );
    
    if (csv && csv.generated_date_from && csv.generated_date_to) {
      const csvStart = new Date(csv.generated_date_from).getTime();
      const csvEnd = new Date(csv.generated_date_to).getTime();
      const reqStart = new Date(dateFrom).getTime();
      const reqEnd = new Date(dateTo).getTime();
      
      const isCovered = csvStart <= reqStart && csvEnd >= reqEnd;
      coverageMap.set(meterId, isCovered);
    } else {
      coverageMap.set(meterId, false);
    }
  }
  
  return coverageMap;
}

/**
 * Get parent meters that have uploaded (not generated) CSV files
 */
export async function getMetersWithUploadedCsvs(meterIds: string[]): Promise<Set<string>> {
  if (meterIds.length === 0) return new Set();
  
  const { data, error } = await supabase
    .from('meter_csv_files')
    .select('meter_id, file_name')
    .in('meter_id', meterIds)
    .eq('parse_status', 'parsed');
  
  if (error || !data) return new Set();
  
  // Filter out hierarchical CSVs - only return meters with actual uploaded data
  const uploadedMeterIds = data
    .filter(d => !d.file_name.toLowerCase().includes('hierarchical'))
    .map(d => d.meter_id);
  
  return new Set(uploadedMeterIds);
}

/**
 * Fetch connections from schematic_lines metadata as fallback
 */
export async function fetchSchematicConnections(siteId: string): Promise<MeterConnection[]> {
  try {
    // Get all schematics for this site
    const { data: schematics, error: schematicsError } = await supabase
      .from('schematics')
      .select('id')
      .eq('site_id', siteId);
    
    if (schematicsError || !schematics?.length) {
      console.log('No schematics found for site');
      return [];
    }
    
    // Get schematic_lines with connection metadata
    const { data: lines, error: linesError } = await supabase
      .from('schematic_lines')
      .select('metadata')
      .in('schematic_id', schematics.map(s => s.id));
    
    if (linesError || !lines) {
      console.error('Error fetching schematic lines:', linesError);
      return [];
    }
    
    // Extract unique parent-child pairs from metadata
    const connections: MeterConnection[] = [];
    const seenPairs = new Set<string>();
    
    lines.forEach(line => {
      const metadata = line.metadata as any;
      // Schematic lines are drawn from child to parent, so field names are inverted
      const actualParentId = metadata?.child_meter_id;   // End of line = parent
      const actualChildId = metadata?.parent_meter_id;   // Start of line = child
      
      if (actualParentId && actualChildId) {
        const pairKey = `${actualParentId}-${actualChildId}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          connections.push({ parent_meter_id: actualParentId, child_meter_id: actualChildId });
        }
      }
    });
    
    console.log(`Found ${connections.length} connections from schematic_lines`);
    return connections;
  } catch (error) {
    console.error('Error fetching schematic connections:', error);
    return [];
  }
}
