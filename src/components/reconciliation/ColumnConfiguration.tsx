import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColumnConfigurationProps {
  availableColumns: string[];
  selectedColumns: Set<string>;
  columnOperations: Map<string, string>;
  columnFactors: Map<string, string>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectedColumnsChange: (columns: Set<string>) => void;
  onColumnOperationsChange: (operations: Map<string, string>) => void;
  onColumnFactorsChange: (factors: Map<string, string>) => void;
}

export function ColumnConfiguration({
  availableColumns,
  selectedColumns,
  columnOperations,
  columnFactors,
  isOpen,
  onOpenChange,
  onSelectedColumnsChange,
  onColumnOperationsChange,
  onColumnFactorsChange,
}: ColumnConfigurationProps) {
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelected = new Set<string>(availableColumns);
      onSelectedColumnsChange(newSelected);
      const newOps = new Map(columnOperations);
      const newFactors = new Map(columnFactors);
      availableColumns.forEach((col: string) => {
        if (!newOps.has(col)) newOps.set(col, "sum");
        if (!newFactors.has(col)) newFactors.set(col, "1");
      });
      onColumnOperationsChange(newOps);
      onColumnFactorsChange(newFactors);
    } else {
      onSelectedColumnsChange(new Set());
    }
  };

  const handleColumnSelect = (column: string, checked: boolean) => {
    const newSelected = new Set(selectedColumns);
    if (checked) {
      newSelected.add(column);
      if (!columnOperations.has(column)) {
        const newOps = new Map(columnOperations);
        newOps.set(column, "sum");
        onColumnOperationsChange(newOps);
      }
      if (!columnFactors.has(column)) {
        const newFactors = new Map(columnFactors);
        newFactors.set(column, "1");
        onColumnFactorsChange(newFactors);
      }
    } else {
      newSelected.delete(column);
    }
    onSelectedColumnsChange(newSelected);
  };

  const handleOperationChange = (column: string, value: string) => {
    const newOps = new Map(columnOperations);
    newOps.set(column, value);
    onColumnOperationsChange(newOps);
  };

  const handleFactorChange = (column: string, value: string) => {
    const newFactors = new Map(columnFactors);
    newFactors.set(column, value || "1");
    onColumnFactorsChange(newFactors);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
        <CollapsibleTrigger className="flex items-center justify-between w-full mb-3 hover:underline">
          <Label className="text-sm font-semibold cursor-pointer">
            Available Columns - Select to Include in Calculations
          </Label>
          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-12">
                    <Checkbox
                      id="select-all-columns"
                      checked={selectedColumns.size === availableColumns.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="font-semibold">
                    <span 
                      className="cursor-pointer hover:underline"
                      onClick={() => handleSelectAll(selectedColumns.size !== availableColumns.length)}
                    >
                      Column Name
                    </span>
                  </TableHead>
                  <TableHead className="w-32 font-semibold">Operation</TableHead>
                  <TableHead className="w-24 font-semibold">Factor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availableColumns.map((column: string) => (
                  <TableRow key={column} className="hover:bg-muted/30">
                    <TableCell className="py-2">
                      <Checkbox
                        id={`column-${column}`}
                        checked={selectedColumns.has(column)}
                        onCheckedChange={(checked) => handleColumnSelect(column, !!checked)}
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Label
                        htmlFor={`column-${column}`}
                        className="text-sm cursor-pointer font-medium"
                      >
                        {column}
                      </Label>
                    </TableCell>
                    <TableCell className="py-2">
                      {selectedColumns.has(column) ? (
                        <Select
                          value={columnOperations.get(column) || "sum"}
                          onValueChange={(value) => handleOperationChange(column, value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sum">Sum</SelectItem>
                            <SelectItem value="min">Min</SelectItem>
                            <SelectItem value="max">Max</SelectItem>
                            <SelectItem value="average">Average</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      {selectedColumns.has(column) ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={columnFactors.get(column) || 1}
                          onChange={(e) => handleFactorChange(column, e.target.value)}
                          className="h-8 text-xs"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
