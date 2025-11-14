import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const StorageMigrationTool = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runMigration = async () => {
    setIsRunning(true);
    setResults(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('migrate-storage-structure');
      
      if (error) throw error;
      
      setResults(data);
      toast.success("Migration completed successfully!");
    } catch (error: any) {
      console.error('Migration error:', error);
      toast.error(`Migration failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Storage Structure Migration</CardTitle>
        <CardDescription>
          Migrate existing files to the new hierarchical folder structure
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={runMigration} 
          disabled={isRunning}
          className="w-full"
        >
          {isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isRunning ? "Running Migration..." : "Run Migration"}
        </Button>

        {results && (
          <div className="mt-4 p-4 bg-muted rounded-lg space-y-2">
            <h3 className="font-semibold">Migration Results:</h3>
            {results.summary && (
              <div className="space-y-1 text-sm">
                <p>Total Files: {results.summary.totalFiles}</p>
                <p>Migrated: {results.summary.migratedFiles}</p>
                <p>Errors: {results.summary.totalErrors}</p>
              </div>
            )}
            
            {results.results && (
              <div className="space-y-2 text-sm">
                {results.results.map((result: any, idx: number) => (
                  <div key={idx} className="border-t pt-2">
                    <p className="font-medium">{result.bucket}</p>
                    <p>Migrated: {result.migratedFiles} / {result.totalFiles}</p>
                    {result.errors.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-destructive">
                          {result.errors.length} errors
                        </summary>
                        <ul className="ml-4 mt-1 text-xs">
                          {result.errors.slice(0, 5).map((err: string, i: number) => (
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
