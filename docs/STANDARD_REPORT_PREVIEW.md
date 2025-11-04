# Standard Report Preview System

## Overview
The `StandardReportPreview` component provides a consistent, professional way to preview PDF reports across the application. It uses `react-pdf` for rendering and includes pagination, download capabilities, and error handling.

## Features
- ✅ Multi-page PDF navigation with Previous/Next buttons
- ✅ Page counter (e.g., "Page 2 of 5")
- ✅ Download functionality with loading states
- ✅ Cache-busting for fresh PDF loads
- ✅ Loading spinner during PDF fetch
- ✅ Error handling with fallback download option
- ✅ Full-screen modal dialog
- ✅ Responsive layout
- ✅ Selectable text in PDF
- ✅ Professional appearance with shadows

## Usage

### Basic Implementation

```typescript
import { useState } from "react";
import { StandardReportPreview } from "@/components/shared/StandardReportPreview";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";

function MyReportsList() {
  const [previewReport, setPreviewReport] = useState<any>(null);

  return (
    <>
      {/* Preview button */}
      <Button onClick={() => setPreviewReport(report)}>
        <Eye className="h-4 w-4 mr-2" />
        Preview
      </Button>

      {/* Preview dialog */}
      {previewReport && (
        <StandardReportPreview
          report={previewReport}
          open={!!previewReport}
          onOpenChange={(open) => !open && setPreviewReport(null)}
          storageBucket="site-documents"
        />
      )}
    </>
  );
}
```

### Component Props

```typescript
interface StandardReportPreviewProps {
  report: any;              // Must have: file_path, report_name
  open: boolean;            // Dialog open state
  onOpenChange: (open: boolean) => void; // Dialog state handler
  storageBucket?: string;   // Storage bucket name (default: "site-reports")
}
```

### Report Object Structure

Your report object must contain at minimum:

```typescript
{
  file_path: string;    // Path in Supabase Storage
  report_name: string;  // Display name for the report
}
```

### Storage Buckets

Specify the correct storage bucket based on your use case:
- `"site-documents"` - General site documents
- `"site-reports"` - Site-specific reports
- `"tariff-extractions"` - Tariff extraction reports
- Custom bucket name as needed

### Example: Integration in SavedReportsList

```typescript
const [previewReport, setPreviewReport] = useState<SavedReport | null>(null);

// In your JSX
<Button
  variant="ghost"
  size="sm"
  onClick={() => setPreviewReport(report)}
  title="Preview report"
>
  <Eye className="w-4 h-4" />
</Button>

{previewReport && (
  <StandardReportPreview
    report={{
      file_path: previewReport.file_path,
      report_name: previewReport.file_name,
    }}
    open={!!previewReport}
    onOpenChange={(open) => !open && setPreviewReport(null)}
    storageBucket="site-documents"
  />
)}
```

## Key Features Explained

### Cache Busting
PDFs are loaded with a timestamp query parameter to ensure fresh content:
```typescript
const urlWithCacheBust = `${data.publicUrl}?t=${Date.now()}`;
```

### Multi-Page Navigation
Navigation controls automatically appear only for PDFs with more than one page:
```typescript
{numPages > 1 && !isLoading && !hasError && (
  <div className="flex items-center gap-4">
    <Button onClick={goToPrevPage} disabled={pageNumber <= 1}>
      Previous
    </Button>
    <span>{pageNumber} / {numPages}</span>
    <Button onClick={goToNextPage} disabled={pageNumber >= numPages}>
      Next
    </Button>
  </div>
)}
```

### Error Handling
If the PDF fails to load, users see a fallback download button:
```typescript
{hasError && (
  <div className="text-center">
    <p>Unable to display PDF preview</p>
    <Button onClick={handleDownload}>
      Download PDF Instead
    </Button>
  </div>
)}
```

### Download with Loading State
Download includes proper loading states and toast notifications:
```typescript
const handleDownload = async () => {
  setIsDownloading(true);
  try {
    // Download and trigger browser download
    toast.success("Report downloaded successfully");
  } catch (error) {
    toast.error("Failed to download report");
  } finally {
    setIsDownloading(false);
  }
};
```

## Styling

The component uses consistent styling:
- **Dialog**: `max-w-5xl` width, `h-[90vh]` height
- **PDF Width**: Fixed at 700px for consistent rendering
- **Background**: Muted background around PDF
- **Shadow**: `shadow-lg` on PDF pages for depth
- **Colors**: Uses theme colors for buttons and text

## Best Practices

1. **Always provide a report object** with `file_path` and `report_name`
2. **Use meaningful report names** for user clarity
3. **Handle the open state properly** to ensure dialog closes correctly
4. **Specify the correct storage bucket** for your use case
5. **Add tooltips/titles** to preview buttons for accessibility
6. **Position preview buttons consistently** (e.g., before download, after view)

## Dependencies

Required packages (already in project):
- `react-pdf`
- `pdfjs-dist`
- `@/components/ui/dialog` (shadcn)
- `@/components/ui/button` (shadcn)
- `lucide-react` (icons)
- `sonner` (toast notifications)

## Migration Guide

If you have existing custom PDF preview implementations:

1. **Remove custom PDF viewers** - Replace with `StandardReportPreview`
2. **Update state management** - Use the pattern shown above
3. **Update button handlers** - Set preview report instead of custom logic
4. **Remove iframe implementations** - Not recommended for PDFs
5. **Test with your storage bucket** - Ensure correct bucket name

## Troubleshooting

### PDF Not Loading
- Check storage bucket name is correct
- Verify file_path exists in storage
- Check browser console for errors
- Ensure storage bucket has public access if needed

### Download Not Working
- Verify Supabase storage permissions
- Check file exists at specified path
- Review browser console for errors
- Test with different browsers

### Navigation Not Appearing
- Navigation only shows for multi-page PDFs
- Check `numPages` state value
- Ensure PDF loaded successfully

## Future Enhancements

Potential improvements:
- Zoom controls
- Print functionality
- Fullscreen mode toggle
- Thumbnail navigation
- Search within PDF
- Annotation support
