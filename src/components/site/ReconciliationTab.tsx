import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, Download, Eye, FileDown, ChevronRight, ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Papa from "papaparse";

interface ReconciliationTabProps {
  siteId: string;
}

export default function ReconciliationTab({ siteId }: ReconciliationTabProps) {
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [timeFrom, setTimeFrom] = useState<string>("00:00");
  const [timeTo, setTimeTo] = useState<string>("23:59");
  const [reconciliationData, setReconciliationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [columnOperations, setColumnOperations] = useState<Map<string, string>>(new Map());
  const [columnFactors, setColumnFactors] = useState<Map<string, string>>(new Map());
  const [recalculatedTotal, setRecalculatedTotal] = useState<number | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isDateFromOpen, setIsDateFromOpen] = useState(false);
  const [isDateToOpen, setIsDateToOpen] = useState(false);
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [availableMeters, setAvailableMeters] = useState<Array<{
    id: string;
    meter_number: string;
    meter_type: string;
    hasData: boolean;
  }>>([]);
  const [meterDateRange, setMeterDateRange] = useState<{
    earliest: Date | null;
    latest: Date | null;
    readingsCount: number;
  }>({ earliest: null, latest: null, readingsCount: 0 });
  const [meterIndentLevels, setMeterIndentLevels] = useState<Map<string, number>>(new Map());
  const [draggedMeterId, setDraggedMeterId] = useState<string | null>(null);
  const [dragOverMeterId, setDragOverMeterId] = useState<string | null>(null);

  // Fetch available meters with CSV data and build hierarchy
  useEffect(() => {
    const fetchAvailableMeters = async () => {
      try {
        // Get all meters for this site
        const { data: meters, error: metersError } = await supabase
          .from("meters")
          .select("id, meter_number, meter_type")
          .eq("site_id", siteId)
          .order("meter_number");

        if (metersError || !meters) {
          console.error("Error fetching meters:", metersError);
          return;
        }

        // Fetch meter connections
        const { data: connections, error: connectionsError } = await supabase
          .from("meter_connections")
          .select("parent_meter_id, child_meter_id");

        if (connectionsError) {
          console.error("Error fetching meter connections:", connectionsError);
        }

        // Build connection map: check meter ID → tenant meter IDs
        // DB structure: tenant (parent) → check (child)
        // For display: we want to group tenant meters under their check meter
        const checkMeterToTenants = new Map<string, string[]>();
        
        connections?.forEach(conn => {
          // conn.child_meter_id is the check meter
          // conn.parent_meter_id is the tenant meter
          if (!checkMeterToTenants.has(conn.child_meter_id)) {
            checkMeterToTenants.set(conn.child_meter_id, []);
          }
          checkMeterToTenants.get(conn.child_meter_id)!.push(conn.parent_meter_id);
        });

        // Check which meters have CSV files uploaded
        const metersWithData = await Promise.all(
          meters.map(async (meter) => {
            const { data: csvFiles } = await supabase
              .from("meter_csv_files")
              .select("id")
              .eq("meter_id", meter.id)
              .limit(1);

            return {
              ...meter,
              hasData: csvFiles && csvFiles.length > 0,
            };
          })
        );

        // Build hierarchical meter list
        const meterMap = new Map(metersWithData.map(m => [m.id, m]));
        const processedMeters = new Set<string>();
        const hierarchicalMeters: typeof metersWithData = [];
        const indentLevels = new Map<string, number>();

        // Check if we have any connections in the database
        const hasConnections = connections && connections.length > 0;

        if (hasConnections) {
          // Use meter_type for indent levels
          const typeToLevel: Record<string, number> = {
            'bulk_meter': 0,
            'check_meter': 1,
            'tenant_meter': 2,
            'other': 3
          };

          // Sort meters by type priority, then alphabetically
          const sortedMeters = [...metersWithData].sort((a, b) => {
            const levelA = typeToLevel[a.meter_type] ?? 999;
            const levelB = typeToLevel[b.meter_type] ?? 999;
            if (levelA !== levelB) return levelA - levelB;
            return a.meter_number.localeCompare(b.meter_number);
          });

          // Group check meters with their tenant meters
          const tenantMeterIds = new Set<string>();
          checkMeterToTenants.forEach(tenants => {
            tenants.forEach(id => tenantMeterIds.add(id));
          });

          // Display bulk meters first
          sortedMeters.forEach(meter => {
            if (meter.meter_type === 'bulk_meter') {
              hierarchicalMeters.push(meter);
              indentLevels.set(meter.id, 0);
              processedMeters.add(meter.id);
            }
          });

          // Display check meters with their tenant meters grouped underneath
          sortedMeters.forEach(meter => {
            if (meter.meter_type === 'check_meter' && !processedMeters.has(meter.id)) {
              hierarchicalMeters.push(meter);
              indentLevels.set(meter.id, 1);
              processedMeters.add(meter.id);

              // Add tenant meters connected to this check meter
              const tenantIds = checkMeterToTenants.get(meter.id) || [];
              tenantIds.forEach(tenantId => {
                const tenantMeter = metersWithData.find(m => m.id === tenantId);
                if (tenantMeter && !processedMeters.has(tenantId)) {
                  hierarchicalMeters.push(tenantMeter);
                  indentLevels.set(tenantId, 2);
                  processedMeters.add(tenantId);
                }
              });
            }
          });

          // Display any remaining tenant meters (not connected to check meters)
          sortedMeters.forEach(meter => {
            if (meter.meter_type === 'tenant_meter' && !processedMeters.has(meter.id)) {
              hierarchicalMeters.push(meter);
              indentLevels.set(meter.id, 2);
              processedMeters.add(meter.id);
            }
          });

          // Display other meters
          sortedMeters.forEach(meter => {
            if (meter.meter_type === 'other' && !processedMeters.has(meter.id)) {
              hierarchicalMeters.push(meter);
              indentLevels.set(meter.id, 3);
              processedMeters.add(meter.id);
            }
          });
        } else {
          // Fallback: Use meter types to create visual hierarchy
          // Bulk (0) → Check (1) → Tenant (2) → Other (3)
          const getIndentByType = (meterType: string): number => {
            switch (meterType) {
              case 'bulk_meter': return 0;
              case 'check_meter': return 1;
              case 'tenant_meter': return 2;
              case 'other': return 3;
              default: return 3;
            }
          };

          // Sort meters by type hierarchy
          const sortedMeters = [...metersWithData].sort((a, b) => {
            const levelA = getIndentByType(a.meter_type);
            const levelB = getIndentByType(b.meter_type);
            if (levelA !== levelB) return levelA - levelB;
            return a.meter_number.localeCompare(b.meter_number);
          });

          sortedMeters.forEach(meter => {
            hierarchicalMeters.push(meter);
            indentLevels.set(meter.id, getIndentByType(meter.meter_type));
          });
        }

        setAvailableMeters(hierarchicalMeters);
        setMeterIndentLevels(indentLevels);

        // Auto-select first meter with data, or bulk meter if available
        const bulkMeter = hierarchicalMeters.find(m => m.meter_type === "bulk_meter" && m.hasData);
        const firstMeterWithData = hierarchicalMeters.find(m => m.hasData);
        
        if (bulkMeter) {
          setSelectedMeterId(bulkMeter.id);
        } else if (firstMeterWithData) {
          setSelectedMeterId(firstMeterWithData.id);
        }
      } catch (error) {
        console.error("Error fetching available meters:", error);
      }
    };

    fetchAvailableMeters();
  }, [siteId]);

  // Fetch meter-specific date range when meter is selected
  useEffect(() => {
    if (!selectedMeterId) {
      setMeterDateRange({ earliest: null, latest: null, readingsCount: 0 });
      return;
    }

    const fetchMeterDateRange = async () => {
      try {
        // Get earliest timestamp
        const { data: earliestData, error: earliestError } = await supabase
          .from("meter_readings")
          .select("reading_timestamp")
          .eq("meter_id", selectedMeterId)
          .order("reading_timestamp", { ascending: true })
          .limit(1);

        // Get latest timestamp
        const { data: latestData, error: latestError } = await supabase
          .from("meter_readings")
          .select("reading_timestamp")
          .eq("meter_id", selectedMeterId)
          .order("reading_timestamp", { ascending: false })
          .limit(1);

        // Get total count
        const { count, error: countError } = await supabase
          .from("meter_readings")
          .select("*", { count: "exact", head: true })
          .eq("meter_id", selectedMeterId);

        if (earliestError || latestError || countError) {
          console.error("Error fetching meter date range:", earliestError || latestError || countError);
          return;
        }

        if (!earliestData || earliestData.length === 0 || !latestData || latestData.length === 0) {
          setMeterDateRange({ earliest: null, latest: null, readingsCount: 0 });
          return;
        }

        const earliest = new Date(earliestData[0].reading_timestamp);
        const latest = new Date(latestData[0].reading_timestamp);

        setMeterDateRange({
          earliest,
          latest,
          readingsCount: count || 0
        });

        // Auto-adjust date pickers to meter's date range
        setDateFrom(earliest);
        setDateTo(latest);
        setTimeFrom(format(earliest, "HH:mm"));
        setTimeTo(format(latest, "HH:mm"));
      } catch (error) {
        console.error("Error fetching meter date range:", error);
      }
    };

    fetchMeterDateRange();
  }, [selectedMeterId]);

  const handleRecalculateTotals = () => {
    if (!previewData || selectedColumns.size === 0) {
      toast.error("Please select columns to calculate");
      return;
    }

    setIsRecalculating(true);

    try {
      let newTotal = 0;
      
      Array.from(selectedColumns).forEach((column) => {
        const operation = columnOperations.get(column) || "sum";
        const factorStr = columnFactors.get(column) || "1";
        let factor = 1;
        
        try {
          factor = Function('"use strict"; return (' + factorStr + ')')();
          if (isNaN(factor) || !isFinite(factor)) {
            factor = 1;
          }
        } catch (e) {
          console.warn(`Invalid factor for ${column}: ${factorStr}, using 1`);
          factor = 1;
        }
        
        // Only sum columns with "sum" operation
        if (operation === "sum") {
          const total = Number(previewData.columnTotals[column] || 0);
          const adjustedTotal = total * factor;
          newTotal += adjustedTotal;
        }
      });

      setRecalculatedTotal(newTotal);
      toast.success("Total consumption recalculated");
    } catch (error) {
      console.error("Recalculation error:", error);
      toast.error("Failed to recalculate totals");
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleIndentMeter = (meterId: string) => {
    const currentLevel = meterIndentLevels.get(meterId) || 0;
    const newLevel = Math.min(currentLevel + 1, 3); // Max 3 levels
    const newLevels = new Map(meterIndentLevels);
    newLevels.set(meterId, newLevel);
    setMeterIndentLevels(newLevels);
  };

  const handleOutdentMeter = (meterId: string) => {
    const currentLevel = meterIndentLevels.get(meterId) || 0;
    const newLevel = Math.max(currentLevel - 1, 0); // Min 0 levels
    const newLevels = new Map(meterIndentLevels);
    newLevels.set(meterId, newLevel);
    setMeterIndentLevels(newLevels);
  };

  const handleDragStart = (e: React.DragEvent, meterId: string) => {
    setDraggedMeterId(meterId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = (meterId: string) => {
    setDragOverMeterId(meterId);
  };

  const handleDragLeave = () => {
    setDragOverMeterId(null);
  };

  const handleDrop = (e: React.DragEvent, targetMeterId: string) => {
    e.preventDefault();
    
    if (!draggedMeterId || draggedMeterId === targetMeterId) {
      setDraggedMeterId(null);
      setDragOverMeterId(null);
      return;
    }

    const draggedIndex = availableMeters.findIndex(m => m.id === draggedMeterId);
    const targetIndex = availableMeters.findIndex(m => m.id === targetMeterId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedMeterId(null);
      setDragOverMeterId(null);
      return;
    }

    const newMeters = [...availableMeters];
    const [removed] = newMeters.splice(draggedIndex, 1);
    newMeters.splice(targetIndex, 0, removed);

    setAvailableMeters(newMeters);
    setDraggedMeterId(null);
    setDragOverMeterId(null);
  };

  const handleDragEnd = () => {
    setDraggedMeterId(null);
    setDragOverMeterId(null);
  };

  // Helper to combine date and time and format as naive timestamp string
  const getFullDateTime = (date: Date, time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hrs = String(hours).padStart(2, '0');
    const mins = String(minutes).padStart(2, '0');
    // Return formatted string without timezone: "YYYY-MM-DD HH:mm:ss"
    return `${year}-${month}-${day} ${hrs}:${mins}:00`;
  };

  const handlePreview = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!selectedMeterId) {
      toast.error("Please select a meter to preview");
      return;
    }

    setIsLoadingPreview(true);

    try {
      // First check if there's any data in the selected range
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      const { count, error: countError } = await supabase
        .from("meter_readings")
        .select("*", { count: "exact", head: true })
        .eq("meter_id", selectedMeterId)
        .gte("reading_timestamp", fullDateTimeFrom)
        .lte("reading_timestamp", fullDateTimeTo);

      if (countError) throw countError;

      if (count === 0) {
        toast.error(
          `No data found for the selected date range. This meter has data from ${
            meterDateRange.earliest ? format(meterDateRange.earliest, "MMM dd, yyyy") : "N/A"
          } to ${
            meterDateRange.latest ? format(meterDateRange.latest, "MMM dd, yyyy") : "N/A"
          }`
        );
        setIsLoadingPreview(false);
        return;
      }

      // Fetch the selected meter
      const { data: meterData, error: meterError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("id", selectedMeterId)
        .single();

      if (meterError || !meterData) {
        toast.error("Failed to fetch selected meter");
        setIsLoadingPreview(false);
        return;
      }

      const selectedMeter = meterData;

      // Fetch column mapping from CSV file
      const { data: csvFile, error: csvError } = await supabase
        .from("meter_csv_files")
        .select("column_mapping")
        .eq("meter_id", selectedMeter.id)
        .not("column_mapping", "is", null)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (csvError) {
        console.error("Error fetching column mapping:", csvError);
      }

      const columnMapping = csvFile?.column_mapping as any;

      // Fetch ALL readings using pagination (Supabase has 1000-row server limit)
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: readingsError } = await supabase
          .from("meter_readings")
          .select("*")
          .eq("meter_id", selectedMeter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (readingsError) {
          toast.error(`Failed to fetch readings: ${readingsError.message}`);
          setIsLoadingPreview(false);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize; // Continue if we got a full page
        } else {
          hasMore = false;
        }
      }

      const readings = allReadings;

      if (!readings || readings.length === 0) {
        toast.error("No readings found in selected date range");
        setIsLoadingPreview(false);
        return;
      }

      // Debug: Log actual number of readings fetched
      console.log(`Preview: Fetched ${readings.length} readings for meter ${selectedMeter.meter_number}`);

      // Extract available columns from column_mapping configuration
      const availableColumns = new Set<string>();
      if (columnMapping && columnMapping.renamedHeaders) {
        // Use the renamed headers from the parsing configuration
        Object.values(columnMapping.renamedHeaders).forEach((headerName: any) => {
          if (headerName && typeof headerName === 'string') {
            availableColumns.add(headerName);
          }
        });
      } else if (readings.length > 0) {
        // Fallback: extract from first reading's metadata if no column mapping
        const metadata = readings[0].metadata as any;
        if (metadata && metadata.imported_fields) {
          Object.keys(metadata.imported_fields).forEach(key => {
            availableColumns.add(key);
          });
        }
      }

      // Debug logging
      console.log('Column Mapping:', columnMapping);
      console.log('Available Columns:', Array.from(availableColumns));
      console.log('Sample Reading Metadata:', readings[0]?.metadata);

      // Auto-select all columns initially
      setSelectedColumns(new Set(availableColumns));

      // Calculate totals and store raw values for operations
      const totalKwh = readings.reduce((sum, r) => sum + Number(r.kwh_value || 0), 0);
      const columnTotals: Record<string, number> = {};
      const columnValues: Record<string, number[]> = {};
      
      readings.forEach(reading => {
        const metadata = reading.metadata as any;
        const importedFields = metadata?.imported_fields || {};
        Object.entries(importedFields).forEach(([key, value]) => {
          const numValue = Number(value);
          if (!isNaN(numValue) && value !== null && value !== '') {
            // Store for sum operation
            columnTotals[key] = (columnTotals[key] || 0) + numValue;
            // Store raw values for other operations
            if (!columnValues[key]) {
              columnValues[key] = [];
            }
            columnValues[key].push(numValue);
          }
        });
      });

      setPreviewData({
        meterNumber: selectedMeter.meter_number,
        meterType: selectedMeter.meter_type,
        totalReadings: readings.length,
        firstReading: readings[0],
        lastReading: readings[readings.length - 1],
        sampleReadings: readings.slice(0, 5),
        availableColumns: Array.from(availableColumns),
        totalKwh,
        columnTotals,
        columnValues
      });

      toast.success("Preview loaded successfully");
    } catch (error) {
      console.error("Preview error:", error);
      toast.error("Failed to load preview");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleReconcile = async () => {
    if (!dateFrom || !dateTo) {
      toast.error("Please select a date range");
      return;
    }

    if (!previewData) {
      toast.error("Please preview data first");
      return;
    }

    if (selectedColumns.size === 0) {
      toast.error("Please select at least one column to calculate");
      return;
    }

    setIsLoading(true);

    try {
      // Fetch all meters for the site
      const { data: meters, error: metersError } = await supabase
        .from("meters")
        .select("id, meter_number, meter_type")
        .eq("site_id", siteId);

      if (metersError) {
        console.error("Error fetching meters:", metersError);
        throw new Error("Failed to fetch meters");
      }

      if (!meters || meters.length === 0) {
        toast.error("No meters found for this site");
        setIsLoading(false);
        return;
      }

      // Combine date and time for precise filtering
      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch readings for each meter within date range (deduplicated by timestamp)
      const meterData = await Promise.all(
        meters.map(async (meter) => {
          // Get ALL readings using pagination (Supabase has 1000-row server limit)
          let allReadings: any[] = [];
          let from = 0;
          const pageSize = 1000;
          let hasMore = true;

          while (hasMore) {
            const { data: pageData, error: readingsError } = await supabase
              .from("meter_readings")
              .select("kwh_value, reading_timestamp, metadata")
              .eq("meter_id", meter.id)
              .gte("reading_timestamp", fullDateTimeFrom)
              .lte("reading_timestamp", fullDateTimeTo)
              .order("reading_timestamp", { ascending: true })
              .range(from, from + pageSize - 1);

            if (readingsError) {
              console.error(`Error fetching readings for meter ${meter.meter_number}:`, readingsError);
              break;
            }

            if (pageData && pageData.length > 0) {
              allReadings = [...allReadings, ...pageData];
              from += pageSize;
              hasMore = pageData.length === pageSize;
            } else {
              hasMore = false;
            }
          }

          const readings = allReadings;

          // Deduplicate by timestamp (take first occurrence of each unique timestamp)
          const uniqueReadings = readings ? 
            Array.from(
              new Map(
                readings.map(r => [r.reading_timestamp, r])
              ).values()
            ) : [];

          // Sum all interval readings (each represents consumption for that period)
          let totalKwh = 0;
          const columnTotals: Record<string, number> = {};
          const columnMaxValues: Record<string, number> = {};
          
          if (uniqueReadings.length > 0) {
            // Sum all interval consumption values
            totalKwh = uniqueReadings.reduce((sum, r) => sum + Number(r.kwh_value), 0);
            
            // Process all numeric columns from metadata
            const columnValues: Record<string, number[]> = {};
            uniqueReadings.forEach(reading => {
              const importedFields = (reading.metadata as any)?.imported_fields || {};
              Object.entries(importedFields).forEach(([key, value]) => {
                // Skip timestamp columns
                if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) return;
                
                // Only process selected columns
                if (!selectedColumns.has(key)) return;
                
                const numValue = Number(value);
                if (!isNaN(numValue) && value !== null && value !== '') {
                  if (!columnValues[key]) {
                    columnValues[key] = [];
                  }
                  columnValues[key].push(numValue);
                }
              });
            });
            
            // Apply operations and scaling to each column
            Object.entries(columnValues).forEach(([key, values]) => {
              const operation = columnOperations.get(key) || 'sum';
              const factor = Number(columnFactors.get(key) || 1);
              
              let result = 0;
              switch (operation) {
                case 'sum':
                  result = values.reduce((sum, val) => sum + val, 0);
                  break;
                case 'average':
                  result = values.reduce((sum, val) => sum + val, 0) / values.length;
                  break;
                case 'max':
                  result = Math.max(...values);
                  break;
                case 'min':
                  result = Math.min(...values);
                  break;
              }
              
              // Apply scaling factor
              result = result * factor;
              
              // For kVA columns, track as max values
              if (key.toLowerCase().includes('kva') || key.toLowerCase().includes('s (kva)')) {
                columnMaxValues[key] = result;
              } else {
                columnTotals[key] = result;
              }
            });
            
            // Debug logging
            console.log(`Reconciliation: Meter ${meter.meter_number} (${meter.meter_type}):`, {
              originalReadings: readings?.length || 0,
              uniqueReadings: uniqueReadings.length,
              duplicatesRemoved: (readings?.length || 0) - uniqueReadings.length,
              totalKwh: totalKwh.toFixed(2),
              columnTotals,
              columnMaxValues,
              firstTimestamp: uniqueReadings[0].reading_timestamp,
              lastTimestamp: uniqueReadings[uniqueReadings.length - 1].reading_timestamp
            });
            
            // Alert if we hit the query limit
            if (readings && readings.length >= 100000) {
              console.warn(`WARNING: Meter ${meter.meter_number} may have more than 100k readings - increase limit!`);
            }
          } else {
            console.log(`Meter ${meter.meter_number}: No readings in date range`);
          }

          return {
            ...meter,
            totalKwh,
            columnTotals,
            columnMaxValues,
            readingsCount: uniqueReadings.length,
          };
        })
      );

      const bulkMeters = meterData.filter((m) => m.meter_type === "bulk_meter");
      const checkMeters = meterData.filter((m) => m.meter_type === "check_meter");
      const otherMeters = meterData.filter((m) => m.meter_type === "other");
      const tenantMeters = meterData.filter((m) => m.meter_type === "tenant_meter");

      const bulkTotal = bulkMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      const otherTotal = otherMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      const tenantTotal = tenantMeters.reduce((sum, m) => sum + m.totalKwh, 0);
      
      // Total supply = Bulk (from grid) + Other (e.g., solar generation)
      const totalSupply = bulkTotal + otherTotal;
      const recoveryRate = totalSupply > 0 ? (tenantTotal / totalSupply) * 100 : 0;
      const discrepancy = totalSupply - tenantTotal;

      setReconciliationData({
        bulkMeters,
        checkMeters,
        otherMeters,
        tenantMeters,
        bulkTotal,
        councilTotal: bulkTotal, // Grid supply (alias for bulkTotal)
        otherTotal,
        totalSupply,
        tenantTotal,
        recoveryRate,
        discrepancy,
      });

      toast.success("Reconciliation complete");
    } catch (error) {
      console.error("Reconciliation error:", error);
      toast.error("Failed to complete reconciliation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadMeterCSV = async (meter: any) => {
    try {
      if (!dateFrom || !dateTo) {
        toast.error("Date range not available");
        return;
      }

      toast.loading(`Fetching readings for ${meter.meter_number}...`);

      const fullDateTimeFrom = getFullDateTime(dateFrom, timeFrom);
      const fullDateTimeTo = getFullDateTime(dateTo, timeTo);

      // Fetch ALL readings for this meter using pagination
      let allReadings: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error } = await supabase
          .from("meter_readings")
          .select("reading_timestamp, kwh_value, kva_value, metadata")
          .eq("meter_id", meter.id)
          .gte("reading_timestamp", fullDateTimeFrom)
          .lte("reading_timestamp", fullDateTimeTo)
          .order("reading_timestamp", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) {
          toast.dismiss();
          toast.error(`Failed to fetch readings: ${error.message}`);
          return;
        }

        if (pageData && pageData.length > 0) {
          allReadings = [...allReadings, ...pageData];
          from += pageSize;
          hasMore = pageData.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      if (allReadings.length === 0) {
        toast.dismiss();
        toast.error("No readings found for this meter");
        return;
      }

      // Transform readings to CSV format
      const csvData = allReadings.map(reading => {
        const row: any = {
          timestamp: format(new Date(reading.reading_timestamp), "yyyy-MM-dd HH:mm:ss"),
          kwh: reading.kwh_value,
        };

        if (reading.kva_value) {
          row.kva = reading.kva_value;
        }

        // Add metadata fields if available
        if (reading.metadata && (reading.metadata as any).imported_fields) {
          const importedFields = (reading.metadata as any).imported_fields;
          Object.entries(importedFields).forEach(([key, value]) => {
            row[key] = value;
          });
        }

        return row;
      });

      // Generate CSV
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${meter.meter_number}_${format(dateFrom, "yyyy-MM-dd")}_to_${format(dateTo, "yyyy-MM-dd")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.dismiss();
      toast.success(`Downloaded ${allReadings.length} readings for ${meter.meter_number}`);
    } catch (error) {
      console.error("CSV download error:", error);
      toast.dismiss();
      toast.error("Failed to download CSV");
    }
  };

  const downloadAllMetersCSV = async () => {
    if (!reconciliationData) return;

    const allMeters = [
      ...reconciliationData.bulkMeters,
      ...reconciliationData.checkMeters,
      ...reconciliationData.otherMeters,
      ...reconciliationData.tenantMeters,
    ];

    for (const meter of allMeters) {
      await downloadMeterCSV(meter);
      // Small delay between downloads to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Energy Reconciliation</h2>
        <p className="text-muted-foreground">
          Balance total supply (grid + solar) against downstream distribution
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Bulk Check Meter + Solar Generation = Total Supply ≈ Sum of all Distribution Meters
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Analysis Parameters</CardTitle>
          <CardDescription>Select date range for reconciliation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Meter to Preview</Label>
            <Select
              value={selectedMeterId || ""}
              onValueChange={setSelectedMeterId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a meter" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  // Group meters by type
                  const groupedMeters = availableMeters.reduce((acc, meter) => {
                    if (!acc[meter.meter_type]) {
                      acc[meter.meter_type] = [];
                    }
                    acc[meter.meter_type].push(meter);
                    return acc;
                  }, {} as Record<string, typeof availableMeters>);

                  // Sort meter types for consistent display
                  const meterTypeOrder = ['bulk_meter', 'check_meter', 'distribution', 'tenant_meter', 'solar_meter'];
                  const sortedTypes = Object.keys(groupedMeters).sort((a, b) => {
                    const indexA = meterTypeOrder.indexOf(a);
                    const indexB = meterTypeOrder.indexOf(b);
                    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                    if (indexA !== -1) return -1;
                    if (indexB !== -1) return 1;
                    return a.localeCompare(b);
                  });

                  return sortedTypes.map((meterType) => (
                    <SelectGroup key={meterType}>
                      <SelectLabel>
                        {meterType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                      </SelectLabel>
                      {groupedMeters[meterType].map((meter) => (
                        <SelectItem
                          key={meter.id}
                          value={meter.id}
                          disabled={!meter.hasData}
                        >
                          <div className="flex items-center gap-2">
                            <span>{meter.meter_number}</span>
                            {!meter.hasData && (
                              <Badge variant="outline" className="text-xs">
                                No data
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ));
                })()}
              </SelectContent>
            </Select>
            {selectedMeterId && meterDateRange.earliest && meterDateRange.latest && (
              <div className="mt-2 p-3 bg-muted/50 rounded-md space-y-1">
                <p className="text-sm font-medium">Selected Meter Data Range:</p>
                <p className="text-sm text-muted-foreground">
                  {format(meterDateRange.earliest, "MMM dd, yyyy HH:mm")} to{" "}
                  {format(meterDateRange.latest, "MMM dd, yyyy HH:mm")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Total readings: {meterDateRange.readingsCount.toLocaleString()}
                </p>
              </div>
            )}
            {selectedMeterId && !meterDateRange.earliest && (
              <p className="text-sm text-muted-foreground mt-2">
                No data available for this meter
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Date & Time</Label>
              <Popover open={isDateFromOpen} onOpenChange={setIsDateFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? `${format(dateFrom, "PP")} at ${timeFrom}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateFrom} 
                      onSelect={(date) => {
                        setDateFrom(date);
                        setIsDateFromOpen(false);
                      }}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
                      <Input
                        type="time"
                        value={timeFrom}
                        onChange={(e) => setTimeFrom(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>To Date & Time</Label>
              <Popover open={isDateToOpen} onOpenChange={setIsDateToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? `${format(dateTo, "PP")} at ${timeTo}` : "Pick date & time"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
                  <div>
                    <Calendar 
                      mode="single" 
                      selected={dateTo} 
                      onSelect={(date) => {
                        setDateTo(date);
                        setIsDateToOpen(false);
                      }}
                      className={cn("p-3 pointer-events-auto")}
                      disabled={false}
                      fromYear={2000}
                      toYear={2050}
                      captionLayout="dropdown-buttons"
                    />
                    <div className="px-3 pb-3">
                      <Input
                        type="time"
                        value={timeTo}
                        onChange={(e) => setTimeTo(e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button onClick={handlePreview} disabled={isLoadingPreview || !dateFrom || !dateTo || !selectedMeterId} className="w-full">
            <Eye className="mr-2 h-4 w-4" />
            {isLoadingPreview ? "Loading Preview..." : "Preview Meter Data"}
          </Button>
        </CardContent>
      </Card>

      {previewData && (
        <Card className="border-border/50 bg-accent/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Meter Data Preview - {previewData.meterNumber} ({previewData.meterType?.replace(/_/g, " ")})</span>
              <Badge variant="outline">{previewData.totalReadings} readings</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">From Date & Time</div>
                      <div className="text-sm font-mono">
                        {dateFrom ? format(dateFrom, "yyyy-MM-dd") : '-'} {timeFrom}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">First Actual Reading Found</div>
                      <div className="text-sm font-mono">
                        {previewData.firstReading.reading_timestamp.split('T')[0]} {previewData.firstReading.reading_timestamp.split('T')[1]?.substring(0, 8) || '00:00:00'}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="p-3 rounded-lg bg-muted/50 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">To Date & Time</div>
                      <div className="text-sm font-mono">
                        {dateTo ? format(dateTo, "yyyy-MM-dd") : '-'} {timeTo}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Last Actual Reading Found</div>
                      <div className="text-sm font-mono">
                        {previewData.lastReading.reading_timestamp.split('T')[0]} {previewData.lastReading.reading_timestamp.split('T')[1]?.substring(0, 8) || '00:00:00'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Available Columns - Select to Include in Calculations</Label>
              <div className="space-y-1">
                {previewData.availableColumns.map((column: string) => (
                  <div key={column} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50">
                    <Checkbox
                      id={`column-${column}`}
                      checked={selectedColumns.has(column)}
                      onCheckedChange={(checked) => {
                        const newSelected = new Set(selectedColumns);
                        if (checked) {
                          newSelected.add(column);
                          if (!columnOperations.has(column)) {
                            const newOps = new Map(columnOperations);
                            newOps.set(column, "sum");
                            setColumnOperations(newOps);
                          }
                          if (!columnFactors.has(column)) {
                            const newFactors = new Map(columnFactors);
                            newFactors.set(column, "1");
                            setColumnFactors(newFactors);
                          }
                        } else {
                          newSelected.delete(column);
                        }
                        setSelectedColumns(newSelected);
                      }}
                    />
                    <Label
                      htmlFor={`column-${column}`}
                      className="text-xs cursor-pointer flex-1"
                    >
                      {column}
                    </Label>
                    {selectedColumns.has(column) && (
                      <>
                        <Select
                          value={columnOperations.get(column) || "sum"}
                          onValueChange={(value) => {
                            const newOps = new Map(columnOperations);
                            newOps.set(column, value);
                            setColumnOperations(newOps);
                          }}
                        >
                          <SelectTrigger className="w-24 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sum">Sum</SelectItem>
                            <SelectItem value="min">Min</SelectItem>
                            <SelectItem value="max">Max</SelectItem>
                            <SelectItem value="average">Avg</SelectItem>
                            <SelectItem value="count">Cnt</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="text"
                          placeholder="Factor"
                          value={columnFactors.get(column) || 1}
                          onChange={(e) => {
                            const newFactors = new Map(columnFactors);
                            newFactors.set(column, e.target.value || "1");
                            setColumnFactors(newFactors);
                          }}
                          className="w-20 h-7 text-xs"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground">
                  {selectedColumns.size} of {previewData.availableColumns.length} columns selected
                </div>
                <Button 
                  onClick={handleRecalculateTotals} 
                  disabled={isRecalculating || selectedColumns.size === 0}
                  variant="outline"
                  size="sm"
                >
                  {isRecalculating ? "Calculating..." : "Recalculate Total"}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <Label className="text-sm font-semibold mb-3 block">Meters Associated with This Site</Label>
              <div className="space-y-2">
                {availableMeters.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No meters found for this site</div>
                ) : (
                  availableMeters.map((meter) => {
                    const indentLevel = meterIndentLevels.get(meter.id) || 0;
                    const marginLeft = indentLevel * 24; // 24px per indent level
                    const isDragging = draggedMeterId === meter.id;
                    const isDragOver = dragOverMeterId === meter.id;
                    
                    return (
                      <div 
                        key={meter.id} 
                        className="flex items-center gap-2"
                        style={{ marginLeft: `${marginLeft}px` }}
                      >
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleOutdentMeter(meter.id)}
                            disabled={indentLevel === 0}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleIndentMeter(meter.id)}
                            disabled={indentLevel >= 3}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                        <div 
                          className={cn(
                            "flex items-center justify-between flex-1 p-3 rounded-md border bg-card hover:bg-accent/5 transition-colors cursor-move",
                            isDragging && "opacity-50",
                            isDragOver && "border-primary border-2"
                          )}
                          draggable
                          onDragStart={(e) => handleDragStart(e, meter.id)}
                          onDragOver={handleDragOver}
                          onDragEnter={() => handleDragEnter(meter.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, meter.id)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="font-medium">{meter.meter_number}</div>
                          <Badge variant={meter.hasData ? "default" : "secondary"}>
                            {meter.hasData ? "Has Data" : "No Data"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>


            <Button onClick={handleReconcile} disabled={isLoading || selectedColumns.size === 0} className="w-full">
              {isLoading ? "Analyzing..." : "Run Reconciliation with Selected Columns"}
            </Button>
          </CardContent>
        </Card>
      )}

      {reconciliationData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Grid Supply
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reconciliationData.councilTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.totalSupply > 0 
                    ? ((reconciliationData.councilTotal / reconciliationData.totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Solar Energy
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Solar</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {reconciliationData.solarTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.totalSupply > 0 
                    ? ((reconciliationData.solarTotal / reconciliationData.totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Supply
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Grid + Solar</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {reconciliationData.totalSupply.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  100.00%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Metered Consumption
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Distribution</div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reconciliationData.distributionTotal.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.totalSupply > 0 
                    ? ((reconciliationData.distributionTotal / reconciliationData.totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unmetered Loss
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-1">Discrepancy</div>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    reconciliationData.discrepancy > 0 ? "text-warning" : "text-accent"
                  )}
                >
                  {reconciliationData.discrepancy.toFixed(2)} kWh
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reconciliationData.totalSupply > 0 
                    ? ((Math.abs(reconciliationData.discrepancy) / reconciliationData.totalSupply) * 100).toFixed(2) 
                    : '0.00'}%
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Detailed Breakdown</CardTitle>
                <CardDescription>Meter-by-meter consumption analysis</CardDescription>
              </div>
              <Button variant="outline" className="gap-2" onClick={downloadAllMetersCSV}>
                <Download className="w-4 h-4" />
                Download All Meters
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Supply Sources */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Supply Sources</h3>
                  
                  {reconciliationData.councilBulk.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Council Bulk (Grid)</h4>
                      <div className="space-y-2">
                        {reconciliationData.councilBulk.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">{col}:</span>
                                    <span className="font-mono">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">{col} (Max):</span>
                                    <span className="font-mono font-semibold">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.solarMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Solar Generation</h4>
                      <div className="space-y-2">
                        {reconciliationData.solarMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-green-50 border border-green-200"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-green-700">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-green-300">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-green-600">{col}:</span>
                                    <span className="font-mono text-green-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-green-600">{col} (Max):</span>
                                    <span className="font-mono font-semibold text-green-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reconciliationData.checkMeters?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">Check Meters</h4>
                      <div className="space-y-2">
                        {reconciliationData.checkMeters.map((meter: any) => (
                          <div
                            key={meter.id}
                            className="space-y-2 p-3 rounded-lg bg-blue-50 border border-blue-200"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-blue-700">{meter.totalKwh.toFixed(2)} kWh</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => downloadMeterCSV(meter)}
                                  className="h-7 w-7 p-0"
                                  title={`Download ${meter.readingsCount} readings`}
                                >
                                  <FileDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                              (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-blue-300">
                                {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-blue-600">{col}:</span>
                                    <span className="font-mono text-blue-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                                {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                  <div key={col} className="flex justify-between text-xs">
                                    <span className="text-blue-600">{col} (Max):</span>
                                    <span className="font-mono font-semibold text-blue-700">{Number(val).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Distribution / Consumption */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b pb-2">Distribution / Consumption</h3>
                  
              {reconciliationData.distribution.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">
                        Downstream Meters
                        <span className="ml-2 text-xs font-normal">
                          (Total: {reconciliationData.distributionTotal.toFixed(2)} kWh)
                        </span>
                      </h4>
                      <div className="space-y-2">
                        {reconciliationData.distribution.map((meter: any) => {
                          const percentage = reconciliationData.distributionTotal > 0 
                            ? (meter.totalKwh / reconciliationData.distributionTotal) * 100 
                            : 0;
                          
                          return (
                            <div
                              key={meter.id}
                              className="space-y-2 p-3 rounded-lg bg-muted/50"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-sm font-semibold">{meter.meter_number}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{meter.totalKwh.toFixed(2)} kWh</span>
                                  <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                                    {percentage.toFixed(2)}%
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => downloadMeterCSV(meter)}
                                    className="h-7 w-7 p-0"
                                    title={`Download ${meter.readingsCount} readings`}
                                  >
                                    <FileDown className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              {((meter.columnTotals && Object.keys(meter.columnTotals).length > 0) || 
                                (meter.columnMaxValues && Object.keys(meter.columnMaxValues).length > 0)) && (
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                                  {Object.entries(meter.columnTotals || {}).map(([col, val]: [string, any]) => (
                                    <div key={col} className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">{col}:</span>
                                      <span className="font-mono">{Number(val).toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {Object.entries(meter.columnMaxValues || {}).map(([col, val]: [string, any]) => (
                                    <div key={col} className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">{col} (Max):</span>
                                      <span className="font-mono font-semibold">{Number(val).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
              )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
