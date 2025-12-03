import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { format } from "date-fns";
import type { DocumentDateRange } from "@/hooks/reconciliation";

interface DocumentPeriodSelectorProps {
  documentDateRanges: DocumentDateRange[];
  selectedDocumentIds: string[];
  isLoadingDocuments: boolean;
  onSelectedDocumentIdsChange: (ids: string[]) => void;
  onDocumentPeriodSelect: (doc: DocumentDateRange) => void;
  onRefreshDocuments: () => void;
}

export function DocumentPeriodSelector({
  documentDateRanges,
  selectedDocumentIds,
  isLoadingDocuments,
  onSelectedDocumentIdsChange,
  onDocumentPeriodSelect,
  onRefreshDocuments,
}: DocumentPeriodSelectorProps) {
  const municipalDocs = documentDateRanges.filter(doc => doc.document_type === 'municipal_account');
  const tenantDocs = documentDateRanges.filter(doc => doc.document_type === 'tenant_bill');

  return (
    <div className="space-y-4">
      {/* Bulk Reconciliation Section */}
      <div className="space-y-2">
        <Label>Bulk Reconciliation - Select Multiple Periods (Municipal Bills Only)</Label>
        <div className="border rounded-md p-3 space-y-2 max-h-[300px] overflow-y-auto bg-background">
          {isLoadingDocuments ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading document periods...
            </div>
          ) : municipalDocs.length > 0 ? (
            municipalDocs.map((doc) => (
              <div key={doc.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`bulk-${doc.id}`}
                  checked={selectedDocumentIds.includes(doc.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onSelectedDocumentIdsChange([...selectedDocumentIds, doc.id]);
                    } else {
                      onSelectedDocumentIdsChange(selectedDocumentIds.filter(id => id !== doc.id));
                    }
                  }}
                />
                <label htmlFor={`bulk-${doc.id}`} className="text-sm cursor-pointer flex-1">
                  {doc.file_name} ({format(new Date(doc.period_start), "MMM d, yyyy")} - {format(new Date(doc.period_end), "MMM d, yyyy")})
                </label>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Click "Load Documents" to fetch available periods</p>
          )}
        </div>
        {selectedDocumentIds.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              {selectedDocumentIds.length} period(s) selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSelectedDocumentIdsChange([])}
            >
              Clear Selection
            </Button>
          </div>
        )}
      </div>

      {/* Document Period Dropdown */}
      <div className="space-y-2">
        <Label>Document Period</Label>
        <div className="flex items-center gap-2">
          <Select
            disabled={isLoadingDocuments || documentDateRanges.length === 0}
            onValueChange={(value) => {
              const selected = documentDateRanges.find(d => d.id === value);
              if (selected) {
                onDocumentPeriodSelect(selected);
              }
            }}
          >
            <SelectTrigger className="flex-1" disabled={isLoadingDocuments}>
              <SelectValue placeholder={
                isLoadingDocuments 
                  ? "Loading..." 
                  : documentDateRanges.length === 0 
                  ? "Click 'Load Documents' to fetch periods" 
                  : "Select a document period..."
              } />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {municipalDocs.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Municipal Bills</div>
                  {municipalDocs.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.file_name} ({format(new Date(doc.period_start), "PP")} - {format(new Date(doc.period_end), "PP")})
                    </SelectItem>
                  ))}
                </>
              )}
              {tenantDocs.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">Tenant Bills</div>
                  {tenantDocs.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.file_name} ({format(new Date(doc.period_start), "PP")} - {format(new Date(doc.period_end), "PP")})
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshDocuments}
            disabled={isLoadingDocuments}
          >
            {isLoadingDocuments ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
