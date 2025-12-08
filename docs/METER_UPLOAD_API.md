# Meter CSV Upload API Documentation

This document provides comprehensive documentation for external applications to integrate with the meter CSV upload and parsing system.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Prerequisites](#prerequisites)
4. [Complete Upload Workflow](#complete-upload-workflow)
5. [Parsing Workflow](#parsing-workflow)
6. [Data Structures](#data-structures)
7. [Storage Path Conventions](#storage-path-conventions)
8. [CSV Format Requirements](#csv-format-requirements)
9. [Error Handling](#error-handling)
10. [Complete Code Examples](#complete-code-examples)
11. [API Reference](#api-reference)

---

## Overview

The meter upload system allows external applications to:
1. Upload CSV files containing meter readings to cloud storage
2. Track uploaded files in a database for management
3. Parse CSV files and insert readings into the meter readings table
4. Handle duplicate detection and error tracking

### Base URL

```
https://azzstsqwrgfapqisovtd.supabase.co
```

### Required Libraries

```bash
# JavaScript/TypeScript
npm install @supabase/supabase-js

# Python
pip install supabase
```

---

## Authentication

### Credentials

| Credential | Purpose | Security Level |
|------------|---------|----------------|
| **Anon Key** | Client-side operations, respects RLS | Public |
| **Service Role Key** | Server-side operations, bypasses RLS | **SENSITIVE** |

### Anon Key (Public)

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6enN0c3F3cmdmYXBxaXNvdnRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3MTY0MzAsImV4cCI6MjA3NjI5MjQzMH0.1d5f8M1mYqM8FhBonc8uZ6E1quiPZQv4PbMXngJ40Ho
```

### Client Initialization

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://azzstsqwrgfapqisovtd.supabase.co',
  'YOUR_ANON_KEY'
);
```

### User Authentication

Before performing any operations, authenticate as a user:

```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'your-password'
});

if (error) throw error;
console.log('Authenticated as:', data.user.email);
```

### Required User Roles

Operations require specific roles:
- **operator** or **admin**: Upload files, track files, parse CSVs
- **admin**: Manage all data

---

## Prerequisites

### 1. Obtain Site ID

```javascript
const { data: sites, error } = await supabase
  .from('sites')
  .select('id, name, clients(id, name)')
  .eq('name', 'Your Site Name')
  .single();

const siteId = sites.id;
```

### 2. Obtain Meter ID

```javascript
const { data: meters, error } = await supabase
  .from('meters')
  .select('id, meter_number, meter_type, name')
  .eq('site_id', siteId)
  .eq('meter_number', 'MTR001');

const meterId = meters[0].id;
```

### 3. Create Meter (if needed)

```javascript
const { data: newMeter, error } = await supabase
  .from('meters')
  .insert({
    site_id: siteId,
    meter_number: 'MTR001',
    meter_type: 'tenant',  // Options: tenant, bulk, solar, check, council_bulk, distribution, other
    name: 'Main Building Meter',
    location: 'Ground Floor'
  })
  .select()
  .single();
```

---

## Complete Upload Workflow

### Step 1: Generate Content Hash

Generate a SHA-256 hash of the file content for duplicate detection:

```javascript
async function generateFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const contentHash = await generateFileHash(csvFile);
```

### Step 2: Check for Duplicates

```javascript
const { data: existingFile } = await supabase
  .from('meter_csv_files')
  .select('id, file_name')
  .eq('site_id', siteId)
  .eq('content_hash', contentHash)
  .maybeSingle();

if (existingFile) {
  throw new Error(`Duplicate file: ${existingFile.file_name}`);
}
```

### Step 3: Generate Storage Path

The storage path follows a hierarchical pattern:

```
{ClientName}/{SiteName}/Metering/Meters/{MeterNumber}/CSVs/{filename}
```

```javascript
// Get site and client names
const { data: siteData } = await supabase
  .from('sites')
  .select('name, clients(name)')
  .eq('id', siteId)
  .single();

const clientName = siteData.clients.name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
const siteName = siteData.name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
const meterNumber = 'MTR001';
const fileName = 'readings_2024.csv';

const filePath = `${clientName}/${siteName}/Metering/Meters/${meterNumber}/CSVs/${fileName}`;
```

### Step 4: Upload to Storage

```javascript
const { data, error: uploadError } = await supabase.storage
  .from('client-files')
  .upload(filePath, csvFile, { 
    upsert: false,  // Prevent overwriting
    contentType: 'text/csv'
  });

if (uploadError) {
  if (uploadError.message.includes('already exists')) {
    throw new Error('File already exists in storage');
  }
  throw uploadError;
}
```

### Step 5: Track in Database

```javascript
const { data: user } = await supabase.auth.getUser();

const { data: fileRecord, error: trackError } = await supabase
  .from('meter_csv_files')
  .insert({
    meter_id: meterId,
    site_id: siteId,
    file_name: fileName,
    file_path: filePath,
    content_hash: contentHash,
    file_size: csvFile.size,
    uploaded_by: user?.user?.id,
    parse_status: 'uploaded',
    upload_status: 'uploaded',
    separator: 'tab',           // Options: tab, comma, semicolon, space
    header_row_number: 1        // Row number containing headers (1-indexed)
  })
  .select()
  .single();

if (trackError) throw trackError;

console.log('File tracked with ID:', fileRecord.id);
```

---

## Parsing Workflow

### Step 1: Configure Column Mapping

```javascript
const columnMapping = {
  // Core column indices (0-indexed)
  dateColumn: "0",           // Column index for date
  timeColumn: "1",           // Column index for time (-1 if combined with date)
  valueColumn: "2",          // Column index for kWh value
  kvaColumn: "3",            // Column index for kVA value (-1 if not present)
  
  // Date/Time formats
  dateFormat: "YYYY-MM-DD",  // Date format pattern
  timeFormat: "HH:mm",       // Time format pattern
  dateTimeFormat: "YYYY-MM-DD HH:mm:ss",  // Combined datetime format
  
  // Optional: Rename column headers
  renamedHeaders: {
    "4": "P1 (kWh)",         // Rename column index 4
    "5": "P2 (kWh)",
    "6": "S (kVA)"
  },
  
  // Optional: Specify data types for extra columns
  columnDataTypes: {
    "4": "float",            // Parse as float
    "5": "float",
    "6": "float",
    "7": "string"
  },
  
  // Optional: Split columns (for combined date/time in single column)
  splitColumns: {
    "0": {
      separator: "space",    // Options: space, comma, dash, slash, colon
      parts: [
        { columnId: "0_split_0", name: "Date" },
        { columnId: "0_split_1", name: "Time" }
      ]
    }
  }
};
```

### Step 2: Update CSV File Record

```javascript
const { error: updateError } = await supabase
  .from('meter_csv_files')
  .update({
    separator: 'tab',
    header_row_number: 1,
    column_mapping: columnMapping,
    parse_status: 'pending'
  })
  .eq('id', csvFileId);

if (updateError) throw updateError;
```

### Step 3: Invoke Parse Function

```javascript
const { data, error } = await supabase.functions.invoke('process-meter-csv', {
  body: {
    csvFileId: csvFileId,           // Required: ID from meter_csv_files
    meterId: meterId,               // Required: Target meter ID
    separator: '\t',                // Tab character for tab-separated
    headerRowNumber: 1,             // 1-indexed header row
    columnMapping: columnMapping,   // Column configuration
    targetTable: 'meter_readings'   // Target table (default: meter_readings)
  }
});

if (error) throw error;

console.log('Parse result:', {
  success: data.success,
  readingsInserted: data.readingsInserted,
  duplicatesSkipped: data.duplicatesSkipped,
  parseErrors: data.parseErrors
});
```

### Parse Function Response

```typescript
interface ParseResponse {
  success: boolean;
  readingsInserted: number;
  duplicatesSkipped: number;
  parseErrors: number;
  errors?: string[];           // First 5 error messages
  parsedFilePath?: string;     // Path to standardized parsed CSV
  error?: string;              // Error message if success=false
}
```

---

## Data Structures

### meter_csv_files Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `site_id` | uuid | Reference to sites table |
| `meter_id` | uuid | Reference to meters table |
| `file_name` | text | Original filename |
| `file_path` | text | Storage path in client-files bucket |
| `content_hash` | text | SHA-256 hash for deduplication |
| `file_size` | integer | File size in bytes |
| `separator` | text | Column separator: tab, comma, semicolon, space |
| `header_row_number` | integer | Header row number (1-indexed) |
| `column_mapping` | jsonb | Column configuration object |
| `upload_status` | text | Upload status: uploaded |
| `parse_status` | text | Parse status: pending, uploaded, parsed, generated, error |
| `uploaded_by` | uuid | User ID who uploaded |
| `uploaded_at` | timestamp | Upload timestamp |
| `parsed_at` | timestamp | Parse completion timestamp |
| `readings_inserted` | integer | Number of readings inserted |
| `duplicates_skipped` | integer | Number of duplicates skipped |
| `parse_errors` | integer | Number of parse errors |
| `error_message` | text | Error message if parsing failed |
| `parsed_file_path` | text | Path to standardized parsed CSV |

### meter_readings Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `meter_id` | uuid | Reference to meters table |
| `reading_timestamp` | timestamp | Timestamp of the reading |
| `kwh_value` | numeric | Energy value in kWh |
| `kva_value` | numeric | Demand value in kVA (nullable) |
| `metadata` | jsonb | Additional columns from CSV |
| `uploaded_by` | uuid | User ID who uploaded |
| `created_at` | timestamp | Record creation timestamp |

### Metadata Structure

Extra columns from the CSV are stored in the `metadata` JSONB field:

```json
{
  "source": "Parsed",
  "source_file": "readings_2024.csv",
  "imported_fields": {
    "P1 (kWh)": 125.5,
    "P2 (kWh)": 89.3,
    "S (kVA)": 45.2,
    "Power Factor": 0.95
  }
}
```

### ColumnMapping Interface

```typescript
interface ColumnMapping {
  // Core column mappings (string index or split column ID)
  dateColumn: string;           // e.g., "0" or "0_split_0"
  timeColumn: string;           // e.g., "1" or "-1" if combined
  valueColumn: string;          // e.g., "2"
  kvaColumn: string;            // e.g., "3" or "-1" if not present
  
  // Format specifications
  dateFormat: string;           // e.g., "YYYY-MM-DD", "DD/MM/YYYY"
  timeFormat: string;           // e.g., "HH:mm", "HH:mm:ss"
  dateTimeFormat?: string;      // e.g., "YYYY-MM-DD HH:mm:ss"
  
  // Column customization
  renamedHeaders?: Record<string, string>;  // { "4": "Custom Name" }
  columnDataTypes?: Record<string, DataType>; // { "4": "float" }
  
  // Split column configuration
  splitColumns?: Record<number, SplitConfig>;
}

type DataType = 'datetime' | 'float' | 'int' | 'string' | 'boolean';

interface SplitConfig {
  separator: 'space' | 'comma' | 'dash' | 'slash' | 'colon';
  parts: Array<{
    columnId: string;  // e.g., "0_split_0"
    name: string;      // Display name
  }>;
}
```

---

## Storage Path Conventions

### Bucket: `client-files`

All meter CSV files are stored in the `client-files` public bucket.

### Path Pattern

```
{ClientName}/{SiteName}/Metering/Meters/{MeterNumber}/CSVs/{filename}
```

### Path Sanitization

Names are sanitized by:
1. Removing special characters (except spaces and hyphens)
2. Normalizing multiple spaces to single space
3. Trimming whitespace

```javascript
function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### Example Paths

```
Acme Corp/Main Building/Metering/Meters/MTR001/CSVs/readings_jan_2024.csv
Acme Corp/Main Building/Metering/Meters/MTR001/CSVs/readings_feb_2024.csv
```

### Parsed File Output

Standardized parsed CSVs are saved alongside the original:

```
{original_path_without_extension}_parsed.csv
```

---

## CSV Format Requirements

### Supported Separators

| Separator | Code | Character |
|-----------|------|-----------|
| Tab | `tab` or `\t` | `\t` |
| Comma | `comma` or `,` | `,` |
| Semicolon | `semicolon` or `;` | `;` |
| Space | `space` | (whitespace) |

### Header Row

- Headers are optional but recommended
- Specify `header_row_number` (1-indexed)
- Set to `0` for no headers

### Date Format Patterns

| Pattern | Example |
|---------|---------|
| `YYYY-MM-DD HH:mm:ss` | 2024-01-15 14:30:00 |
| `YYYY-MM-DD HH:mm` | 2024-01-15 14:30 |
| `DD/MM/YYYY HH:mm:ss` | 15/01/2024 14:30:00 |
| `DD/MM/YYYY HH:mm` | 15/01/2024 14:30 |
| `MM/DD/YYYY HH:mm:ss` | 01/15/2024 14:30:00 |
| `YYYY/MM/DD HH:mm:ss` | 2024/01/15 14:30:00 |
| `DD-MM-YYYY HH:mm:ss` | 15-01-2024 14:30:00 |

### Required Columns

| Column | Required | Description |
|--------|----------|-------------|
| Date/DateTime | Yes | Reading timestamp |
| Time | No | Separate time if not combined |
| kWh Value | Yes | Energy consumption value |
| kVA Value | No | Demand value |

### Example CSV Formats

**Format 1: Separate Date and Time**
```csv
Date	Time	kWh	kVA	P1	P2
2024-01-15	00:00	125.5	45.2	80.1	45.4
2024-01-15	00:30	128.3	46.1	82.5	45.8
```

**Format 2: Combined DateTime**
```csv
DateTime,kWh,kVA
2024-01-15 00:00:00,125.5,45.2
2024-01-15 00:30:00,128.3,46.1
```

**Format 3: Multiple Energy Columns**
```csv
Date;Time;P1 (kWh);P2 (kWh);S (kVA)
15/01/2024;00:00;80.1;45.4;45.2
15/01/2024;00:30;82.5;45.8;46.1
```

---

## Error Handling

### Common Error Codes

| Error | Cause | Solution |
|-------|-------|----------|
| `Duplicate file` | File with same hash exists | Skip upload or use different file |
| `already exists` | Storage path occupied | Use upsert or rename file |
| `Failed to download CSV` | File not in storage | Verify file was uploaded |
| `Invalid date format` | Date doesn't match pattern | Update dateFormat in mapping |
| `No file path provided` | Missing csvFileId or filePath | Provide valid csvFileId |

### Checking Parse Status

```javascript
const { data: fileStatus } = await supabase
  .from('meter_csv_files')
  .select('parse_status, readings_inserted, parse_errors, error_message')
  .eq('id', csvFileId)
  .single();

console.log('Status:', fileStatus.parse_status);
console.log('Readings:', fileStatus.readings_inserted);
console.log('Errors:', fileStatus.parse_errors);

if (fileStatus.error_message) {
  console.error('Error:', fileStatus.error_message);
}
```

### Parse Status Values

| Status | Description |
|--------|-------------|
| `pending` | Awaiting parsing |
| `uploaded` | File uploaded, not yet parsed |
| `parsed` | Successfully parsed from uploaded file |
| `generated` | Generated via hierarchical aggregation |
| `error` | Parsing failed |

---

## Complete Code Examples

### JavaScript/TypeScript

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://azzstsqwrgfapqisovtd.supabase.co',
  'YOUR_ANON_KEY'
);

async function uploadAndParseMeterCsv(
  email,
  password,
  siteId,
  meterNumber,
  csvFile
) {
  // 1. Authenticate
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (authError) throw authError;

  // 2. Get meter ID
  const { data: meters } = await supabase
    .from('meters')
    .select('id')
    .eq('site_id', siteId)
    .eq('meter_number', meterNumber);
  
  if (!meters?.length) throw new Error('Meter not found');
  const meterId = meters[0].id;

  // 3. Generate content hash
  const buffer = await csvFile.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // 4. Check for duplicates
  const { data: existing } = await supabase
    .from('meter_csv_files')
    .select('id')
    .eq('site_id', siteId)
    .eq('content_hash', contentHash)
    .maybeSingle();
  
  if (existing) throw new Error('Duplicate file');

  // 5. Get site info for path
  const { data: siteData } = await supabase
    .from('sites')
    .select('name, clients(name)')
    .eq('id', siteId)
    .single();

  const sanitize = (s) => s.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
  const filePath = `${sanitize(siteData.clients.name)}/${sanitize(siteData.name)}/Metering/Meters/${meterNumber}/CSVs/${csvFile.name}`;

  // 6. Upload to storage
  const { error: uploadError } = await supabase.storage
    .from('client-files')
    .upload(filePath, csvFile, { upsert: false });
  
  if (uploadError) throw uploadError;

  // 7. Track in database
  const { data: fileRecord, error: trackError } = await supabase
    .from('meter_csv_files')
    .insert({
      meter_id: meterId,
      site_id: siteId,
      file_name: csvFile.name,
      file_path: filePath,
      content_hash: contentHash,
      file_size: csvFile.size,
      uploaded_by: authData.user.id,
      parse_status: 'uploaded',
      separator: 'tab',
      header_row_number: 1
    })
    .select()
    .single();

  if (trackError) throw trackError;

  // 8. Configure column mapping
  const columnMapping = {
    dateColumn: "0",
    timeColumn: "1",
    valueColumn: "2",
    kvaColumn: "-1",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "HH:mm",
    renamedHeaders: {},
    columnDataTypes: {}
  };

  // 9. Parse CSV
  const { data: parseResult, error: parseError } = await supabase.functions.invoke('process-meter-csv', {
    body: {
      csvFileId: fileRecord.id,
      meterId,
      separator: '\t',
      headerRowNumber: 1,
      columnMapping,
      targetTable: 'meter_readings'
    }
  });

  if (parseError) throw parseError;

  return {
    fileId: fileRecord.id,
    readingsInserted: parseResult.readingsInserted,
    duplicatesSkipped: parseResult.duplicatesSkipped
  };
}
```

### Python

```python
import hashlib
from supabase import create_client, Client

url = "https://azzstsqwrgfapqisovtd.supabase.co"
key = "YOUR_ANON_KEY"
supabase: Client = create_client(url, key)

def upload_and_parse_meter_csv(email, password, site_id, meter_number, file_path):
    # 1. Authenticate
    auth = supabase.auth.sign_in_with_password({
        "email": email,
        "password": password
    })
    
    # 2. Get meter ID
    meters = supabase.table("meters").select("id").eq("site_id", site_id).eq("meter_number", meter_number).execute()
    if not meters.data:
        raise Exception("Meter not found")
    meter_id = meters.data[0]["id"]
    
    # 3. Read file and generate hash
    with open(file_path, "rb") as f:
        file_content = f.read()
    content_hash = hashlib.sha256(file_content).hexdigest()
    
    # 4. Check for duplicates
    existing = supabase.table("meter_csv_files").select("id").eq("site_id", site_id).eq("content_hash", content_hash).maybe_single().execute()
    if existing.data:
        raise Exception("Duplicate file")
    
    # 5. Get site info
    site_data = supabase.table("sites").select("name, clients(name)").eq("id", site_id).single().execute()
    
    def sanitize(s):
        import re
        return re.sub(r'\s+', ' ', re.sub(r'[^a-zA-Z0-9\s-]', '', s)).strip()
    
    file_name = file_path.split("/")[-1]
    storage_path = f"{sanitize(site_data.data['clients']['name'])}/{sanitize(site_data.data['name'])}/Metering/Meters/{meter_number}/CSVs/{file_name}"
    
    # 6. Upload to storage
    supabase.storage.from_("client-files").upload(storage_path, file_content)
    
    # 7. Track in database
    file_record = supabase.table("meter_csv_files").insert({
        "meter_id": meter_id,
        "site_id": site_id,
        "file_name": file_name,
        "file_path": storage_path,
        "content_hash": content_hash,
        "file_size": len(file_content),
        "uploaded_by": auth.user.id,
        "parse_status": "uploaded",
        "separator": "tab",
        "header_row_number": 1
    }).execute()
    
    # 8. Parse CSV
    column_mapping = {
        "dateColumn": "0",
        "timeColumn": "1",
        "valueColumn": "2",
        "kvaColumn": "-1",
        "dateFormat": "YYYY-MM-DD",
        "timeFormat": "HH:mm"
    }
    
    parse_result = supabase.functions.invoke("process-meter-csv", {
        "body": {
            "csvFileId": file_record.data[0]["id"],
            "meterId": meter_id,
            "separator": "\t",
            "headerRowNumber": 1,
            "columnMapping": column_mapping,
            "targetTable": "meter_readings"
        }
    })
    
    return parse_result
```

### cURL

```bash
# 1. Authenticate
AUTH_RESPONSE=$(curl -X POST \
  'https://azzstsqwrgfapqisovtd.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"password"}')

ACCESS_TOKEN=$(echo $AUTH_RESPONSE | jq -r '.access_token')

# 2. Upload file to storage
curl -X POST \
  'https://azzstsqwrgfapqisovtd.supabase.co/storage/v1/object/client-files/ClientName/SiteName/Metering/Meters/MTR001/CSVs/readings.csv' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: text/csv' \
  --data-binary @readings.csv

# 3. Track file in database
curl -X POST \
  'https://azzstsqwrgfapqisovtd.supabase.co/rest/v1/meter_csv_files' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{
    "meter_id": "meter-uuid",
    "site_id": "site-uuid",
    "file_name": "readings.csv",
    "file_path": "ClientName/SiteName/Metering/Meters/MTR001/CSVs/readings.csv",
    "content_hash": "sha256-hash",
    "parse_status": "uploaded",
    "separator": "tab",
    "header_row_number": 1
  }'

# 4. Parse CSV
curl -X POST \
  'https://azzstsqwrgfapqisovtd.supabase.co/functions/v1/process-meter-csv' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "csvFileId": "csv-file-uuid",
    "meterId": "meter-uuid",
    "separator": "\t",
    "headerRowNumber": 1,
    "columnMapping": {
      "dateColumn": "0",
      "timeColumn": "1",
      "valueColumn": "2",
      "kvaColumn": "-1"
    }
  }'
```

---

## API Reference

### Endpoints Summary

| Operation | Method | Endpoint/Table |
|-----------|--------|----------------|
| Authenticate | POST | `/auth/v1/token?grant_type=password` |
| List Sites | GET | `sites` table |
| List Meters | GET | `meters` table |
| Upload File | POST | Storage: `client-files` bucket |
| Track File | POST | `meter_csv_files` table |
| Update Config | PATCH | `meter_csv_files` table |
| Parse CSV | POST | Edge Function: `process-meter-csv` |
| Get Readings | GET | `meter_readings` table |
| Check Status | GET | `meter_csv_files` table |

### Tables Quick Reference

| Table | Purpose |
|-------|---------|
| `sites` | Site information |
| `clients` | Client/company information |
| `meters` | Meter definitions |
| `meter_csv_files` | CSV file tracking |
| `meter_readings` | Parsed meter readings |
| `hierarchical_meter_readings` | Aggregated hierarchical readings |

### Meter Types

| Type | Description |
|------|-------------|
| `council_bulk` | Utility bulk supply meter |
| `bulk` | Building bulk meter |
| `solar` | Solar generation meter |
| `check` | Check/verification meter |
| `tenant` | Tenant sub-meter |
| `distribution` | Distribution meter |
| `other` | Other meter types |

---

## Support

For integration support or API issues, contact the system administrator or refer to the application documentation.

---

*Last updated: December 2024*
