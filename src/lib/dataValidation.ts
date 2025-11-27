// Data validation and corruption detection for meter readings

export interface CorruptionThreshold {
  maxKwhPer30Min: number;    // Max kWh for a single 30-min reading
  maxKvaPer30Min: number;    // Max kVA for a single 30-min reading
  maxMetadataValue: number;  // Max for any metadata column (P1, P2, S, etc.)
}

// Default thresholds - can be adjusted per site
// These are generous defaults:
// - 10,000 kWh per 30 mins = 20MW sustained power
// - 50,000 kVA per 30 mins = very large apparent power
// - 100,000 for any metadata column
export const DEFAULT_THRESHOLDS: CorruptionThreshold = {
  maxKwhPer30Min: 10000,
  maxKvaPer30Min: 50000,
  maxMetadataValue: 100000,
};

export interface CorrectedReading {
  timestamp: string;
  meterId: string;
  meterNumber: string;
  originalValue: number;
  correctedValue: number;
  fieldName: string;
  reason: string;
}

export interface DataValidationResult {
  isCorrupt: boolean;
  reason?: string;
}

/**
 * Check if a value exceeds the threshold for a given field type
 */
export function isValueCorrupt(
  value: number,
  fieldName: string,
  thresholds: CorruptionThreshold = DEFAULT_THRESHOLDS
): DataValidationResult {
  const absValue = Math.abs(value);
  const fieldLower = fieldName.toLowerCase();
  
  // Check if it's a kWh field
  if (fieldLower === 'kwh_value' || fieldLower.includes('kwh')) {
    if (absValue > thresholds.maxKwhPer30Min) {
      return {
        isCorrupt: true,
        reason: `Value ${value.toLocaleString()} exceeds max kWh threshold ${thresholds.maxKwhPer30Min.toLocaleString()}`
      };
    }
    return { isCorrupt: false };
  }
  
  // Check if it's a kVA field
  if (fieldLower.includes('kva') || fieldLower === 's') {
    if (absValue > thresholds.maxKvaPer30Min) {
      return {
        isCorrupt: true,
        reason: `Value ${value.toLocaleString()} exceeds max kVA threshold ${thresholds.maxKvaPer30Min.toLocaleString()}`
      };
    }
    return { isCorrupt: false };
  }
  
  // For all other metadata columns
  if (absValue > thresholds.maxMetadataValue) {
    return {
      isCorrupt: true,
      reason: `Value ${value.toLocaleString()} exceeds max metadata threshold ${thresholds.maxMetadataValue.toLocaleString()}`
    };
  }
  
  return { isCorrupt: false };
}
