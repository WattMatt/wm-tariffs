import { supabase } from "@/integrations/supabase/client";

/**
 * Delete timestamped snippet files by schematic name pattern
 */
export async function deleteSnippetFiles(schematicNamePattern: string) {
  try {
    console.log(`Cleaning up snippets for: ${schematicNamePattern}`);

    // Call the edge function to find and delete matching files
    const { data, error } = await supabase.functions.invoke('cleanup-snippets-by-name', {
      body: { filePattern: schematicNamePattern },
    });

    if (error) {
      console.error('Error deleting files:', error);
      return { success: false, error: error.message };
    }

    console.log('Cleanup result:', data);
    return { 
      success: true, 
      ...data 
    };
  } catch (error) {
    console.error('Error cleaning up snippets:', error);
    return { success: false, error: String(error) };
  }
}

// Auto-cleanup for the specific schematic if called directly
if (typeof window !== 'undefined') {
  (window as any).cleanupSnippets = () => {
    deleteSnippetFiles('412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5')
      .then(result => console.log('Cleanup complete:', result))
      .catch(err => console.error('Cleanup failed:', err));
  };
}
