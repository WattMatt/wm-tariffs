import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const OrphanedFilesCleanup = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runCleanup = async () => {
    setIsRunning(true);
    setResults(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-files');
      
      if (error) throw error;
      
      setResults(data);
      toast.success(`Cleanup completed! ${data.summary.totalRecordsCleaned} records cleaned.`);
    } catch (error: any) {
      console.error('Cleanup error:', error);
      toast.error(`Cleanup failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Orphaned Files Cleanup</CardTitle>
        <CardDescription>
          Find and remove database records that reference non-existent files
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This will delete database records that reference missing files in storage.
            Run the migration tool first if you haven't already.
          </AlertDescription>
        </Alert>

        <Button 
          onClick={runCleanup} 
          disabled={isRunning}
          variant="destructive"
          className="w-full"
        >
          {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isRunning ? "Running Cleanup..." : "Run Cleanup"}
        </Button>

        {results && (
          <div className="mt-4 p-4 bg-muted rounded-lg space-y-2">
            <h3 className="font-semibold">Cleanup Results:</h3>
            {results.summary && (
              <div className="space-y-1 text-sm">
                <p>Tables Checked: {results.summary.totalTables}</p>
                <p>Invalid Records Found: {results.summary.totalInvalidFound}</p>
                <p>Records Cleaned: {results.summary.totalRecordsCleaned}</p>
              </div>
            )}
            
            {results.results && (
              <div className="space-y-2 text-sm mt-4">
                {results.results.map((result: any, idx: number) => (
                  <div key={idx} className="border-t pt-2">
                    <p className="font-medium">{result.bucket}</p>
                    <p>Total Records: {result.totalRecords}</p>
                    <p>Invalid: {result.invalidRecords}</p>
                    <p className="text-green-600 dark:text-green-400">
                      Cleaned: {result.cleanedRecords}
                    </p>
                    {result.errors.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-destructive">
                          {result.errors.length} errors
                        </summary>
                        <ul className="ml-4 mt-1 text-xs">
                          {result.errors.map((err: string, i: number) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
