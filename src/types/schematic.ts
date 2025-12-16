/**
 * Shared types for schematic-related components
 */

/**
 * Base schematic interface - common fields across all usages
 */
export interface Schematic {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string;
  page_number: number;
  total_pages: number;
  created_at: string;
  converted_image_path: string | null;
}

/**
 * Extended schematic with site relationship (used in SchematicViewer)
 */
export interface SchematicWithSite extends Schematic {
  site_id: string;
  sites: {
    name: string;
    clients: { name: string } | null;
  } | null;
}

/**
 * Base meter position interface
 */
export interface MeterPosition {
  id: string;
  meter_id: string;
  x_position: number;
  y_position: number;
  label: string | null;
}

/**
 * Extended meter position with meter details (used when fetching with relations)
 */
export interface MeterPositionWithMeter extends MeterPosition {
  meters: {
    meter_number: string;
    meter_type: string;
    name?: string;
    area?: number | null;
    rating?: string;
    cable_specification?: string;
    serial_number?: string;
    ct_type?: string;
  } | null;
}

/**
 * Meter connection representing parent-child relationships
 */
export interface MeterConnection {
  id: string;
  child_meter_id: string;
  parent_meter_id: string;
}

/**
 * Data extracted from schematic images via AI
 */
export interface ExtractedMeterData {
  meter_number: string;
  name: string;
  area: string | null;
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
  meter_type: string;
  location?: string;
  tariff?: string;
  status?: 'pending' | 'approved' | 'rejected';
  position?: { x: number; y: number };
  scale_x?: number;
  scale_y?: number;
  isDragging?: boolean;
}

/**
 * Editable fields for meter editing UI
 */
export interface EditableMeterFields {
  meter_number: string;
  name: string;
  area: string;
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
}

/**
 * File type icon helper
 */
export function getFileTypeIcon(type: string): string {
  if (type === "application/pdf") return "📄";
  if (type.startsWith("image/")) return "🖼️";
  return "📋";
}
