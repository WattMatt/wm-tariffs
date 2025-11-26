import { supabase } from "@/integrations/supabase/client";

export async function deleteOldSnippets() {
  const filePaths = [
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764147685248.png",
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764148461338.png",
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764149997574.png",
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764150203679.png",
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764150291392.png",
    "Pistorious Group/Thabazimbi Mall/Metering/Schematics/412E300 - SCHEMATIC DISTRIBUTION DIAGRAM 1 OF 2 - REV 5_snippet_1764150369225.png",
  ];

  try {
    const { data, error } = await supabase.functions.invoke('delete-meter-csvs', {
      body: { filePaths },
    });

    if (error) {
      console.error('Error deleting snippets:', error);
      return { success: false, error };
    }

    console.log('Successfully deleted snippets:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Failed to delete snippets:', error);
    return { success: false, error };
  }
}

// Auto-run on load
if (typeof window !== 'undefined') {
  setTimeout(() => {
    deleteOldSnippets().then(result => {
      console.log('Snippet cleanup result:', result);
    });
  }, 2000);
}
