import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, Save, Loader2, Trash2, FolderOpen, ChevronDown, Database } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Settings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [settingsId, setSettingsId] = useState<string>("");
  const [appName, setAppName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [folders, setFolders] = useState<Array<{ name: string; path: string }>>([]);
  const [selectedBucket, setSelectedBucket] = useState<'client-files' | 'tariff-files'>('client-files');

  useEffect(() => {
    checkAuth();
    loadSettings();
    loadFolders("");
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .single();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setAppName(data.app_name);
        setLogoUrl(data.logo_url);
      }
    } catch (error: any) {
      console.error("Error loading settings:", error);
      toast({
        title: "Error",
        description: "Failed to load settings",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadFolders = async (path: string, bucket: 'client-files' | 'tariff-files' = selectedBucket) => {
    setIsLoadingFolders(true);
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(path, {
          limit: 100,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (error) throw error;

      // Filter only folders (items with id === null are folders in Supabase)
      const folderList = (data || [])
        .filter(item => item.id === null)
        .map(item => ({
          name: item.name,
          path: path ? `${path}/${item.name}` : item.name
        }));

      setFolders(folderList);
    } catch (error: any) {
      console.error("Error loading folders:", error);
      toast({
        title: "Error",
        description: "Failed to load folders",
        variant: "destructive",
      });
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const handleBucketChange = (bucket: 'client-files' | 'tariff-files') => {
    setSelectedBucket(bucket);
    setCurrentPath("");
    loadFolders("", bucket);
  };

  const handleFolderClick = (path: string) => {
    setCurrentPath(path);
    loadFolders(path);
  };

  const handleGoBack = () => {
    const pathParts = currentPath.split('/');
    pathParts.pop();
    const newPath = pathParts.join('/');
    setCurrentPath(newPath);
    loadFolders(newPath);
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 2MB",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      // Upload file
      const { generateAppAssetPath } = await import("@/lib/storagePaths");
      const fileExt = file.name.split(".").pop();
      const fileName = `app-logo-${Date.now()}.${fileExt}`;
      const { bucket, path: filePath } = generateAppAssetPath("Logos", fileName);
      
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      
      toast({
        title: "Success",
        description: "Logo uploaded successfully",
      });
    } catch (error: any) {
      console.error("Error uploading logo:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!appName.trim()) {
      toast({
        title: "Validation Error",
        description: "Application name is required",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .update({
          app_name: appName,
          logo_url: logoUrl,
        })
        .eq("id", settingsId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Settings saved successfully. Refresh the page to see changes.",
      });
      
      // Reload the page to refresh all components
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCleanupSnippets = async () => {
    if (!currentPath) {
      toast({
        title: "No Folder Selected",
        description: "Please select a folder from the dropdown first",
        variant: "destructive",
      });
      return;
    }

    setIsCleaningUp(true);
    try {
      toast({
        title: "Cleanup Started",
        description: `Deleting all files in: ${currentPath}`,
      });

      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-snippets', {
        body: { folderPath: currentPath, bucket: selectedBucket }
      });

      if (error) throw error;

      toast({
        title: "Cleanup Complete",
        description: `Deleted ${data.filesDeleted} files and removed ${data.databaseReferencesRemoved} database references from ${currentPath}`,
      });

      // Refresh the folder list after cleanup
      loadFolders(currentPath);
    } catch (error: any) {
      console.error("Cleanup error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup folder",
        variant: "destructive",
      });
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!currentPath) {
      toast({
        title: "No Folder Selected",
        description: "Please select a folder from the dropdown first",
        variant: "destructive",
      });
      return;
    }

    setIsDeletingFolder(true);
    try {
      toast({
        title: "Deleting Folder",
        description: `Removing folder and all contents: ${currentPath}`,
      });

      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-snippets', {
        body: { folderPath: currentPath, bucket: selectedBucket }
      });

      if (error) throw error;

      toast({
        title: "Folder Deleted",
        description: `Deleted ${data.filesDeleted} files and removed ${data.databaseReferencesRemoved} database references. Folder removed: ${currentPath}`,
      });

      // Go back to parent folder after deletion
      handleGoBack();
    } catch (error: any) {
      console.error("Delete folder error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete folder",
        variant: "destructive",
      });
    } finally {
      setIsDeletingFolder(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container max-w-4xl py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Manage application settings and branding
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Application Settings</CardTitle>
            <CardDescription>
              Configure your application name and logo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="appName">Application Name</Label>
              <Input
                id="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="Enter application name"
              />
            </div>

            <div className="space-y-2">
              <Label>Application Logo</Label>
              <div className="flex items-start gap-4">
                {logoUrl && (
                  <div className="w-32 h-32 border rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                    <img
                      src={logoUrl}
                      alt="Application logo"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    disabled={isUploading}
                    className="cursor-pointer"
                  />
                  <p className="text-sm text-muted-foreground">
                    Upload a logo image (max 2MB, PNG, JPG, or SVG)
                  </p>
                  {isUploading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading...
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={handleSaveSettings}
                disabled={isSaving || isUploading}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Settings
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
            <CardDescription>
              System maintenance and cleanup operations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Delete Folder Contents</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select a storage bucket and folder, then click cleanup to delete all files in that folder 
                  and remove all database references to those files. This action cannot be undone.
                </p>
                <div className="mb-3">
                  <Label className="text-sm font-medium mb-2 block">Storage Bucket</Label>
                  <Select value={selectedBucket} onValueChange={(value: 'client-files' | 'tariff-files') => handleBucketChange(value)}>
                    <SelectTrigger className="w-full max-w-xs">
                      <Database className="w-4 h-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client-files">client-files</SelectItem>
                      <SelectItem value="tariff-files">tariff-files</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div className="w-full max-w-full">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={isLoadingFolders} className="w-full max-w-full justify-start truncate">
                          <FolderOpen className="w-4 h-4 mr-2 flex-shrink-0" />
                          <span className="truncate">{currentPath || "Browse Storage"}</span>
                          <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-64 max-h-96 overflow-y-auto bg-background z-50">
                        <DropdownMenuLabel>
                          Current: {currentPath || "Root"}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {currentPath && (
                          <>
                            <DropdownMenuItem onSelect={(e) => {
                              e.preventDefault();
                              handleGoBack();
                            }}>
                              <ChevronDown className="w-4 h-4 mr-2 rotate-90" />
                              Go Back
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        {isLoadingFolders ? (
                          <DropdownMenuItem disabled>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Loading folders...
                          </DropdownMenuItem>
                        ) : folders.length === 0 ? (
                          <DropdownMenuItem disabled>
                            No subfolders found
                          </DropdownMenuItem>
                        ) : (
                          folders.map((folder) => (
                            <DropdownMenuItem
                              key={folder.path}
                              onSelect={(e) => {
                                e.preventDefault();
                                handleFolderClick(folder.path);
                              }}
                            >
                              <FolderOpen className="w-4 h-4 mr-2" />
                              {folder.name}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleCleanupSnippets}
                      disabled={isCleaningUp || isDeletingFolder || !currentPath}
                      variant="destructive"
                    >
                      {isCleaningUp ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Folder Contents
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleDeleteFolder}
                      disabled={isCleaningUp || isDeletingFolder || !currentPath}
                      variant="destructive"
                    >
                      {isDeletingFolder ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Folder
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
