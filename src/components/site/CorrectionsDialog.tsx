import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import type { CorrectedReading } from "@/lib/dataValidation";

interface CorrectionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  meterNumber: string;
  corrections: CorrectedReading[];
}

export default function CorrectionsDialog({ 
  isOpen, 
  onClose, 
  meterNumber, 
  corrections 
}: CorrectionsDialogProps) {
  // Group corrections by meter for better readability
  const correctionsByMeter = corrections.reduce((acc, correction) => {
    const key = correction.meterNumber;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(correction);
    return acc;
  }, {} as Record<string, CorrectedReading[]>);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Data Corrections for {meterNumber}
          </DialogTitle>
          <DialogDescription>
            {corrections.length} corrupt value{corrections.length !== 1 ? 's were' : ' was'} detected and corrected during reconciliation.
            The original data remains unchanged in the source files.
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[60vh] pr-4">
          {Object.entries(correctionsByMeter).map(([meter, meterCorrections]) => (
            <div key={meter} className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {meter}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {meterCorrections.length} correction{meterCorrections.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead className="w-[100px]">Field</TableHead>
                    <TableHead className="w-[150px] text-right">Original Value</TableHead>
                    <TableHead className="w-[120px] text-right">Corrected To</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meterCorrections.map((correction, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(correction.timestamp), 'yyyy-MM-dd HH:mm')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {correction.fieldName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-destructive">
                        {correction.originalValue.toLocaleString(undefined, { 
                          maximumFractionDigits: 2 
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {correction.correctedValue.toLocaleString(undefined, { 
                          maximumFractionDigits: 2 
                        })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                        {correction.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
