import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Loader2, XCircle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionStatus {
  id: string;
  name: string;
  status: 'pending' | 'generating' | 'success' | 'failed';
  error?: string;
}

interface BatchStatus {
  batchNumber: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  sections: SectionStatus[];
}

interface ReportGenerationProgressProps {
  progress: number;
  status: string;
  batches: BatchStatus[];
  currentBatch?: number;
  showSectionDetails?: boolean;
}

export function ReportGenerationProgress({
  progress,
  status,
  batches,
  currentBatch,
  showSectionDetails = true
}: ReportGenerationProgressProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'generating':
      case 'processing':
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case 'success':
      case 'complete':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'text-muted-foreground';
      case 'generating':
      case 'processing':
        return 'text-primary';
      case 'success':
      case 'complete':
        return 'text-green-600';
      case 'failed':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  const totalSections = batches.reduce((sum, batch) => sum + batch.sections.length, 0);
  const completedSections = batches.reduce(
    (sum, batch) => sum + batch.sections.filter(s => s.status === 'success').length,
    0
  );
  const failedSections = batches.reduce(
    (sum, batch) => sum + batch.sections.filter(s => s.status === 'failed').length,
    0
  );

  return (
    <Card className="border-primary/20">
      <CardContent className="pt-6 space-y-4">
        {/* Overall Progress */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">{status}</span>
            <span className="font-mono text-muted-foreground">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Section Summary */}
        {showSectionDetails && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-muted-foreground">
                {completedSections}/{totalSections} Complete
              </span>
            </div>
            {failedSections > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-destructive" />
                <span className="text-destructive">
                  {failedSections} Failed
                </span>
              </div>
            )}
          </div>
        )}

        {/* Batch Progress */}
        {showSectionDetails && (
          <div className="space-y-3">
            {batches.map((batch) => (
              <div
                key={batch.batchNumber}
                className={cn(
                  "rounded-lg border p-3 space-y-2 transition-colors",
                  batch.status === 'processing' && "border-primary/50 bg-primary/5",
                  batch.status === 'complete' && "border-green-600/30 bg-green-50/50 dark:bg-green-950/20",
                  batch.status === 'failed' && "border-destructive/30 bg-destructive/5",
                  batch.status === 'pending' && "border-border bg-muted/30"
                )}
              >
                {/* Batch Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(batch.status)}
                    <span className={cn("font-medium text-sm", getStatusColor(batch.status))}>
                      Batch {batch.batchNumber}
                      {batch.status === 'processing' && currentBatch === batch.batchNumber && (
                        <span className="ml-2 text-xs text-muted-foreground">(Processing...)</span>
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {batch.sections.filter(s => s.status === 'success').length}/{batch.sections.length} sections
                  </span>
                </div>

                {/* Section Details */}
                <div className="space-y-1 pl-6">
                  {batch.sections.map((section) => (
                    <div
                      key={section.id}
                      className="flex items-center justify-between text-xs py-1"
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(section.status)}
                        <span className={cn(getStatusColor(section.status))}>
                          {section.name}
                        </span>
                      </div>
                      {section.status === 'failed' && section.error && (
                        <div className="flex items-center gap-1 text-destructive">
                          <AlertCircle className="w-3 h-3" />
                          <span className="text-[10px] max-w-[200px] truncate" title={section.error}>
                            {section.error}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Warning for Failed Sections */}
        {failedSections > 0 && progress === 100 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-900 dark:text-amber-100">
              <p className="font-medium mb-1">Partial Report Generated</p>
              <p className="text-amber-700 dark:text-amber-300">
                {failedSections} section{failedSections > 1 ? 's' : ''} failed to generate. 
                You can still save and edit the report with the successfully generated sections.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
