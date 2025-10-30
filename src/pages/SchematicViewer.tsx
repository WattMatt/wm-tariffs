import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Edit, Check, X, Pencil, Trash2, Scan } from "lucide-react";
import { toast } from "sonner";
import SchematicEditor from "@/components/schematic/SchematicEditor";
import { MeterDataExtractor } from "@/components/schematic/MeterDataExtractor";
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

interface SchematicData {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string;
  page_number: number;
  total_pages: number;
  site_id: string;
  sites: { name: string; clients: { name: string } | null } | null;
  converted_image_path: string | null;
}

interface MeterPosition {
  id: string;
  x_position: number;
  y_position: number;
  label: string | null;
  meter_id: string;
  meters: {
    meter_number: string;
    meter_type: string;
  } | null;
}

interface MeterConnection {
  id: string;
  child_meter_id: string;
  parent_meter_id: string;
}

interface ExtractedMeterData {
  meter_number: string;
  name: string;
  area: string | null; // Changed to string to preserve "m²" unit
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
  meter_type: string;
  location?: string;
  tariff?: string;
  status?: 'pending' | 'approved' | 'rejected';
  position?: { x: number; y: number };
  scale_x?: number;
  scale_y?: number;
  isDragging?: boolean;
}

interface EditableMeterFields {
  meter_number: string;
  name: string;
  area: string;
  rating: string;
  cable_specification: string;
  serial_number: string;
  ct_type: string;
}

export default function SchematicViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [schematic, setSchematic] = useState<SchematicData | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [meterPositions, setMeterPositions] = useState<MeterPosition[]>([]);
  const [meterConnections, setMeterConnections] = useState<MeterConnection[]>([]);
  const [editMode, setEditMode] = useState(true);
  const [extractedMeters, setExtractedMeters] = useState<ExtractedMeterData[]>([]);
  const [selectedMeterIndex, setSelectedMeterIndex] = useState<number | null>(null);
  const [convertedImageUrl, setConvertedImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [draggedMeterIndex, setDraggedMeterIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isEditingMeter, setIsEditingMeter] = useState(false);
  const [editedMeterData, setEditedMeterData] = useState<EditableMeterFields | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [detectedRectangles, setDetectedRectangles] = useState<any[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawnRegions, setDrawnRegions] = useState<any[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentDrawRect, setCurrentDrawRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfScale, setPdfScale] = useState(0.5);

  // Set up PDF.js worker
  useEffect(() => {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }, []);

  useEffect(() => {
    if (id) {
      fetchSchematic();
      fetchMeterPositions();
    }
  }, [id]);

  // Fetch connections after schematic is loaded
  useEffect(() => {
    if (schematic) {
      fetchMeterConnections();
    }
  }, [schematic]);

  // Real-time subscription for meter positions
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel('meter-positions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meter_positions',
          filter: `schematic_id=eq.${id}`
        },
        (payload) => {
          console.log('🔄 Meter position change detected:', payload);
          fetchMeterPositions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const fetchSchematic = async () => {
    const { data, error } = await supabase
      .from("schematics")
      .select("*, sites(name, clients(name))")
      .eq("id", id)
      .single();

    if (error) {
      toast.error("Failed to load schematic");
      navigate("/schematics");
      return;
    }

    setSchematic(data);

    // For PDFs, check if we have a converted image first
    if (data.file_type === "application/pdf") {
      if (data.converted_image_path) {
        // Use the converted PNG image
        const { data: imageUrlData } = supabase.storage
          .from("schematics")
          .getPublicUrl(data.converted_image_path);
        
        setImageUrl(imageUrlData.publicUrl);
        setConvertedImageUrl(imageUrlData.publicUrl);
      } else {
        // Fall back to PDF URL for viewing
        const { data: pdfUrlData } = supabase.storage
          .from("schematics")
          .getPublicUrl(data.file_path);
        
        setImageUrl(pdfUrlData.publicUrl);
      }
    } else {
      // Regular image file
      const { data: urlData } = supabase.storage
        .from("schematics")
        .getPublicUrl(data.file_path);

      setImageUrl(urlData.publicUrl);
    }
  };

  const convertPdfToImage = async (schematicId: string, filePath: string) => {
    console.log("Converting PDF to high-quality image...");
    setIsConverting(true);
    toast.info("Converting PDF to ultra-high quality image (4x scale)...", { duration: 5000 });
    
    try {
      // Download the PDF from storage
      const { data: pdfBlob, error: downloadError } = await supabase
        .storage
        .from('schematics')
        .download(filePath);
      
      if (downloadError || !pdfBlob) {
        throw new Error('Failed to download PDF');
      }

      console.log('PDF downloaded, starting conversion...');

      // Convert blob to array buffer
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Load PDF with PDF.js
      const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist');
      
      // Use the matching worker version
      GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      
      const loadingTask = getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;
      
      console.log('PDF loaded, rendering at 4x quality...');
      
      // Get first page
      const page = await pdf.getPage(1);
      // Use 4x scale for very high quality (can go up to 6.0 for even higher quality)
      const viewport = page.getViewport({ scale: 4.0 });
      
      console.log(`Rendering at dimensions: ${viewport.width}x${viewport.height}`);
      
      // Create canvas with high-quality rendering settings
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { 
        willReadFrequently: false,
        alpha: false, // No transparency for better quality
      });
      
      if (!context) throw new Error('Could not get canvas context');
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      // Enable high-quality rendering
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      
      // Render PDF page to canvas with high quality
      await page.render({
        canvasContext: context,
        viewport: viewport,
        intent: 'print', // Use print-quality rendering
      } as any).promise;
      
      console.log('PDF rendered, converting to PNG...');
      
      // Convert canvas to blob with maximum quality
      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Blob conversion timeout')), 20000); // Increased timeout for larger image
        canvas.toBlob(
          (blob) => {
            clearTimeout(timeout);
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/png',
          1.0 // Maximum quality
        );
      });
      
      console.log(`PNG created (${(imageBlob.size / 1024 / 1024).toFixed(2)}MB), uploading...`);
      
      // Generate unique filename for converted image
      const imagePath = `${filePath.replace('.pdf', '')}_converted.png`;
      
      // Upload converted image to storage (with upsert to overwrite existing)
      const { error: uploadError } = await supabase
        .storage
        .from('schematics')
        .upload(imagePath, imageBlob, {
          contentType: 'image/png',
          upsert: true, // Overwrite existing file
        });
      
      if (uploadError) throw uploadError;
      
      console.log('Image uploaded, updating database...');
      
      // Update schematic record with converted image path
      const { error: updateError } = await supabase
        .from('schematics')
        .update({ 
          converted_image_path: imagePath,
          updated_at: new Date().toISOString()
        })
        .eq('id', schematicId);
      
      if (updateError) throw updateError;
      
      toast.success("PDF converted to ultra-high quality image successfully!", { duration: 3000 });
      
      // Force browser to reload new image by clearing cache and adding timestamp
      setConvertedImageUrl(null);
      setImageUrl("");
      setImageLoaded(false);
      
      // Wait a moment then reload with cache-busting timestamp
      setTimeout(() => {
        const timestamp = Date.now();
        const { data: urlData } = supabase.storage
          .from("schematics")
          .getPublicUrl(imagePath);
        
        // Add cache-busting parameter to force browser to reload
        const newImageUrl = `${urlData.publicUrl}?t=${timestamp}`;
        setImageUrl(newImageUrl);
        setConvertedImageUrl(newImageUrl);
        
        toast.info("Reloading high-quality image...");
      }, 1000);
    } catch (error: any) {
      console.error("PDF conversion error:", error);
      toast.error(`Failed to convert PDF: ${error?.message || 'Unknown error'}`, { duration: 5000 });
    } finally {
      setIsConverting(false);
    }
  };

  const fetchMeterPositions = async () => {
    const { data } = await supabase
      .from("meter_positions")
      .select("id, meter_id, x_position, y_position, label, scale_x, scale_y, meters(meter_number, meter_type, name, area, rating, cable_specification, serial_number, ct_type)")
      .eq("schematic_id", id);

    setMeterPositions(data || []);
  };

  const fetchMeterConnections = async () => {
    if (!schematic) return;
    
    // Get all meters for this site first
    const { data: siteMeters } = await supabase
      .from("meters")
      .select("id")
      .eq("site_id", schematic.site_id);
    
    if (!siteMeters || siteMeters.length === 0) return;
    
    const meterIds = siteMeters.map(m => m.id);
    
    // Get connections where either child or parent is in this site
    const { data: connections } = await supabase
      .from("meter_connections")
      .select("*")
      .or(`child_meter_id.in.(${meterIds.join(',')}),parent_meter_id.in.(${meterIds.join(',')})`);
    
    setMeterConnections(connections || []);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const delta = e.deltaY;
    
    // CTRL + SCROLL: Zoom in/out with fixed step-based multiplier
    if (e.ctrlKey || e.metaKey) {
      // Use consistent zoom steps: 1.1 for zoom in (delta < 0), 0.9 for zoom out (delta > 0)
      const zoomStep = delta < 0 ? 1.1 : 0.9;
      let newZoom = zoom * zoomStep;
      
      // Clamp zoom between 5% and 1000% for usability
      newZoom = Math.min(Math.max(0.05, newZoom), 10);
      
      if (containerRef.current && imageRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        
        // Get cursor position relative to container
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;
        
        // Calculate the point in the zoomed image that's under the cursor
        const pointX = (mouseX - pan.x) / zoom;
        const pointY = (mouseY - pan.y) / zoom;
        
        // Calculate new pan to keep the point under the cursor
        const newPan = {
          x: mouseX - pointX * newZoom,
          y: mouseY - pointY * newZoom
        };
        
        setPan(newPan);
      }
      
      setZoom(newZoom);
      
      // Show zoom percentage toast
      const zoomPercent = Math.round(newZoom * 100);
      toast(`Zoom: ${zoomPercent}%`, { duration: 800 });
    }
    // SHIFT + SCROLL: Pan left/right with dampening for smooth control
    else if (e.shiftKey) {
      setPan(prev => ({
        x: prev.x - delta * 0.5,
        y: prev.y
      }));
    }
    // SCROLL alone: Pan up/down with dampening for smooth control
    else {
      setPan(prev => ({
        x: prev.x,
        y: prev.y - delta * 0.5
      }));
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Drawing mode - start drawing rectangle
    if (isDrawingMode && imageRef.current && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      
      const imageRect = imageRef.current.getBoundingClientRect();
      const x = ((e.clientX - imageRect.left) / imageRect.width) * 100;
      const y = ((e.clientY - imageRect.top) / imageRect.height) * 100;
      
      setDrawStart({ x, y });
      setCurrentDrawRect({ left: x, top: y, width: 0, height: 0 });
      return;
    }
    
    // Middle mouse button ALWAYS enables panning
    if (e.button === 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grab';
      }
      return;
    }
    
    // Left button pans if not clicking on a meter marker
    if (e.button === 0 && !(e.target as HTMLElement).closest('.meter-marker')) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grabbing';
      }
    }
  };

  const handleMeterMarkerMouseDown = (e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return; // Only left click
    e.stopPropagation();
    
    setDraggedMeterIndex(index);
    
    if (imageRef.current) {
      const imageRect = imageRef.current.getBoundingClientRect();
      const meterPos = extractedMeters[index].position || { x: 0, y: 0 };
      
      // Calculate current marker position in pixels
      const markerX = (meterPos.x / 100) * imageRect.width + imageRect.left;
      const markerY = (meterPos.y / 100) * imageRect.height + imageRect.top;
      
      // Store offset from mouse to marker center
      setDragOffset({
        x: e.clientX - markerX,
        y: e.clientY - markerY
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Drawing mode - update rectangle size
    if (isDrawingMode && drawStart && imageRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      const imageRect = imageRef.current.getBoundingClientRect();
      const currentX = ((e.clientX - imageRect.left) / imageRect.width) * 100;
      const currentY = ((e.clientY - imageRect.top) / imageRect.height) * 100;
      
      const left = Math.min(drawStart.x, currentX);
      const top = Math.min(drawStart.y, currentY);
      const width = Math.abs(currentX - drawStart.x);
      const height = Math.abs(currentY - drawStart.y);
      
      setCurrentDrawRect({ left, top, width, height });
      return;
    }
    
    if (draggedMeterIndex !== null && imageRef.current) {
      // Dragging a meter marker
      e.stopPropagation();
      const imageRect = imageRef.current.getBoundingClientRect();
      
      // Calculate new position relative to image
      const newX = ((e.clientX - dragOffset.x - imageRect.left) / imageRect.width) * 100;
      const newY = ((e.clientY - dragOffset.y - imageRect.top) / imageRect.height) * 100;
      
      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(100, newX));
      const clampedY = Math.max(0, Math.min(100, newY));
      
      const updated = [...extractedMeters];
      updated[draggedMeterIndex] = {
        ...updated[draggedMeterIndex],
        position: { x: clampedX, y: clampedY }
      };
      setExtractedMeters(updated);
    } else if (isDragging) {
      // Panning the view
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grabbing';
      }
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = async () => {
    // Drawing mode - complete the region and extract
    if (isDrawingMode && drawStart && currentDrawRect && currentDrawRect.width > 1 && currentDrawRect.height > 1) {
      toast.info('Extracting meter data from drawn region...');
      
      // Call extraction with the drawn region
      try {
        const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
          body: { 
            imageUrl: convertedImageUrl || imageUrl,
            filePath: schematic?.file_path || null,
            mode: 'extract-region',
            region: currentDrawRect
          }
        });

        if (error) throw new Error(error.message || 'Failed to extract meter data');
        if (!data || !data.meter) throw new Error('No meter data returned');

        // Add the extracted meter with position from the region center
        console.log('📍 Drawing region details:', {
          left: currentDrawRect.left,
          top: currentDrawRect.top,
          width: currentDrawRect.width,
          height: currentDrawRect.height
        });
        
        const centerX = currentDrawRect.left + (currentDrawRect.width / 2);
        const centerY = currentDrawRect.top + (currentDrawRect.height / 2);
        
        // Scale: The default meter card is 200px wide and 140px tall
        // We want to match the drawn region size
        // Assume the canvas is approximately matching the image size
        // A region of 10% width should make the meter 10% of canvas width
        const targetScale = {
          x: currentDrawRect.width / 10, // 10% region = 1.0 scale
          y: currentDrawRect.height / 10  // 10% region = 1.0 scale
        };
        
        const newMeter = {
          ...data.meter,
          status: 'pending' as const,
          position: {
            x: centerX,
            y: centerY
          },
          scale_x: Math.max(0.2, Math.min(3.0, targetScale.x)), // Clamp between 0.2 and 3.0
          scale_y: Math.max(0.2, Math.min(3.0, targetScale.y))
        };
        
        console.log('📏 NEW meter created:', { 
          meter_number: newMeter.meter_number,
          position: newMeter.position,
          scale: { x: newMeter.scale_x, y: newMeter.scale_y }
        });
        console.log('📊 Total meters will be:', extractedMeters.length + 1);
        
        setExtractedMeters([...extractedMeters, newMeter]);
        toast.success(`Extracted meter: ${data.meter.meter_number || 'Unknown'}`);
      } catch (error) {
        console.error('Error extracting from region:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to extract meter data');
      }
      
      // Reset drawing state
      setDrawStart(null);
      setCurrentDrawRect(null);
      setIsDrawingMode(false);
      return;
    }
    
    // Reset drawing if it was too small
    if (isDrawingMode) {
      setDrawStart(null);
      setCurrentDrawRect(null);
    }
    
    if (draggedMeterIndex !== null) {
      setDraggedMeterIndex(null);
      toast.success('Marker position updated');
    }
    setIsDragging(false);
    if (containerRef.current) {
      containerRef.current.style.cursor = isDrawingMode ? 'crosshair' : 'grab';
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grab';
      }
    }
  };

  const handleScanAllMeters = async () => {
    if (!convertedImageUrl && !imageUrl) {
      toast.error("No image available to scan");
      return;
    }

    setIsExtracting(true);
    try {
      console.log('🔍 Starting global scan of schematic...');
      
      const { data, error } = await supabase.functions.invoke('extract-schematic-meters', {
        body: {
          imageUrl: convertedImageUrl || imageUrl,
          mode: 'full-extraction'
        }
      });

      if (error) throw error;
      if (!data || !data.meters || !Array.isArray(data.meters)) {
        throw new Error('No meters returned from scan');
      }

      console.log(`✅ Found ${data.meters.length} meters in scan`);
      
      // Add all scanned meters to extractedMeters
      const scannedMeters = data.meters.map((meter: any) => ({
        ...meter,
        status: 'pending' as const,
        position: meter.position || { x: 50, y: 50 },
        scale_x: meter.scale_x || 1,
        scale_y: meter.scale_y || 1
      }));
      
      setExtractedMeters([...extractedMeters, ...scannedMeters]);
      toast.success(`Scanned and extracted ${scannedMeters.length} meters`);
    } catch (error) {
      console.error('❌ Scan error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to scan meters');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMeterSelect = (index: number) => {
    setSelectedMeterIndex(index);
    setIsEditingMeter(false);
    setEditedMeterData(null);
  };

  const handleStartEdit = () => {
    if (selectedMeterIndex !== null) {
      const meter = extractedMeters[selectedMeterIndex];
      setEditedMeterData({
        meter_number: meter.meter_number,
        name: meter.name,
        area: meter.area?.toString() || '',
        rating: meter.rating,
        cable_specification: meter.cable_specification,
        serial_number: meter.serial_number,
        ct_type: meter.ct_type,
      });
      setIsEditingMeter(true);
    }
  };

  const handleSaveEdit = () => {
    if (selectedMeterIndex !== null && editedMeterData) {
      const updated = [...extractedMeters];
      updated[selectedMeterIndex] = {
        ...updated[selectedMeterIndex],
        meter_number: editedMeterData.meter_number,
        name: editedMeterData.name,
        area: editedMeterData.area, // Keep as string with units (e.g., "187m²")
        rating: editedMeterData.rating,
        cable_specification: editedMeterData.cable_specification,
        serial_number: editedMeterData.serial_number,
        ct_type: editedMeterData.ct_type,
      };
      setExtractedMeters(updated);
      setIsEditingMeter(false);
      setEditedMeterData(null);
      toast.success('Meter data updated');
    }
  };

  const handleCancelEdit = () => {
    setIsEditingMeter(false);
    setEditedMeterData(null);
  };


  useEffect(() => {
    // Reset image loaded state when converted image changes
    if (convertedImageUrl) {
      setImageLoaded(false);
      console.log('🔄 Converted image URL changed, resetting imageLoaded to false');
    }
  }, [convertedImageUrl]);

  // Ensure markers show when extractedMeters updates
  useEffect(() => {
    if (extractedMeters.length > 0) {
      console.log('📍 Extracted meters updated:', extractedMeters.length, 'meters');
      console.log('🖼️ Image loaded state:', imageLoaded);
      console.log('🎯 All meter positions:', extractedMeters.map((m, i) => ({ 
        index: i, 
        position: m.position,
        scale: { x: m.scale_x, y: m.scale_y },
        meter_number: m.meter_number 
      })));
    }
  }, [extractedMeters, imageLoaded]);

  const getMeterColor = (type: string) => {
    switch (type) {
      case "council_bulk":
        return "bg-primary";
      case "check_meter":
        return "bg-warning";
      case "distribution":
        return "bg-accent";
      default:
        return "bg-muted";
    }
  };

  const getMeterStatusColor = (status?: 'pending' | 'approved' | 'rejected') => {
    switch (status) {
      case 'approved': return 'bg-green-500 border-green-700 shadow-green-500/50';
      case 'rejected': return 'bg-red-500 border-red-700 shadow-red-500/50';
      default: return 'bg-yellow-500 border-yellow-700 shadow-yellow-500/50';
    }
  };

  if (!schematic) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading schematic...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
        <div className="flex items-center justify-between py-4 px-6 border-b shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate(`/sites/${schematic.site_id}`)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Site
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{schematic.name}</h1>
              <p className="text-sm text-muted-foreground">
                {schematic.sites?.name} {schematic.sites?.clients && `• ${schematic.sites.clients.name}`}
              </p>
            </div>
          </div>

          {/* Edit mode is now always on */}
        </div>

        {schematic.description && (
          <Card className="border-border/50 mx-6 mt-4 shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{schematic.description}</p>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50 mx-6 my-4 flex-1 overflow-hidden flex flex-col">
          <CardContent className="p-6 flex-1 overflow-hidden flex flex-col">
            {editMode ? (
              <SchematicEditor
                schematicId={id!}
                schematicUrl={imageUrl}
                siteId={schematic.site_id}
                filePath={schematic.file_path}
                extractedMeters={extractedMeters}
                onExtractedMetersUpdate={setExtractedMeters}
              />
            ) : (
              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Main Schematic View */}
                <div className={meterPositions.length > 0 ? "grid grid-cols-[1fr_320px] gap-4 flex-1 overflow-hidden" : "flex-1 overflow-hidden"}>
                  {/* Schematic with markers */}
                  <div className="flex flex-col overflow-hidden">
                    {/* Help text */}
                    <div className="text-xs text-muted-foreground text-center py-1 bg-muted/30 rounded shrink-0">
                      💡 Scroll to zoom • Click and drag to pan
                    </div>
                     <div 
                      ref={containerRef}
                      className="relative bg-muted/20 rounded-lg border-2 border-border/50 flex-1 overflow-hidden"
                      style={{ 
                        cursor: isDragging ? 'grabbing' : 'default'
                      }}
                      onWheel={handleWheel}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseLeave}
                    >
                    <div 
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                      }}
                    >
                       <div className="relative max-h-full">
                        {/* Display PDF directly using react-pdf */}
                        {schematic.file_type === "application/pdf" ? (
                          <div className="relative inline-block max-h-full">
                            <Document
                              file={imageUrl}
                              onLoadSuccess={({ numPages }) => {
                                setPdfNumPages(numPages);
                                setImageLoaded(true);
                                console.log(`PDF loaded with ${numPages} pages`);
                              }}
                              onLoadError={(error) => {
                                console.error('PDF load error:', error);
                                toast.error('Failed to load PDF');
                              }}
                            >
                              <Page
                                pageNumber={pdfPageNumber}
                                scale={pdfScale}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                onRenderSuccess={() => {
                                  console.log('PDF page rendered');
                                }}
                              />
                            </Document>
                            
                            {/* Connection Lines - rendered first so they appear behind markers */}
                            <svg 
                              className="absolute inset-0 pointer-events-none"
                              style={{ 
                                width: '100%', 
                                height: '100%',
                                zIndex: 20
                              }}
                            >
                              {meterConnections.map((connection) => {
                                const childPos = meterPositions.find(p => p.meter_id === connection.child_meter_id);
                                const parentPos = meterPositions.find(p => p.meter_id === connection.parent_meter_id);
                                
                                if (!childPos || !parentPos || !imageRef.current) return null;
                                
                                return (
                                  <line
                                    key={connection.id}
                                    x1={`${childPos.x_position}%`}
                                    y1={`${childPos.y_position}%`}
                                    x2={`${parentPos.x_position}%`}
                                    y2={`${parentPos.y_position}%`}
                                    stroke="#3b82f6"
                                    strokeWidth="3"
                                    opacity="0.7"
                                  />
                                );
                              })}
                            </svg>

                            {/* Existing Meter Position Markers */}
                            {meterPositions.map((position) => (
                              <div
                                key={position.id}
                                className="meter-marker absolute rounded-full border-3 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-all"
                                style={{
                                  left: `${position.x_position}%`,
                                  top: `${position.y_position}%`,
                                  transform: "translate(-50%, -50%)",
                                  transformOrigin: 'center center',
                                  width: '28px',
                                  height: '28px',
                                  backgroundColor: position.meters?.meter_type === 'council_bulk' ? 'hsl(var(--primary))' :
                                                  position.meters?.meter_type === 'check_meter' ? '#f59e0b' :
                                                  '#8b5cf6',
                                  zIndex: 30,
                                }}
                                title={`${position.meters?.meter_number} - ${position.label || ""}`}
                              >
                                <span className="text-[9px] font-bold text-white leading-none">{position.meters?.meter_number?.substring(0, 3)}</span>
                              </div>
                            ))}
                            
                            {/* Detected Rectangle Overlays - Color coded for data availability */}
                            {detectedRectangles.map((rect) => (
                              <div
                                key={rect.id}
                                className="absolute border-3 rounded-md cursor-pointer transition-all hover:scale-105"
                                style={{
                                  left: `${rect.position.x}%`,
                                  top: `${rect.position.y}%`,
                                  width: `${rect.bounds.width}%`,
                                  height: `${rect.bounds.height}%`,
                                  transform: "translate(-50%, -50%)",
                                  borderColor: rect.hasData ? '#10b981' : '#ef4444',
                                  backgroundColor: rect.hasData ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                  zIndex: rect.isExtracting ? 35 : 25,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!rect.hasData && !rect.isExtracting) {
                                    // Extract data for this rectangle
                                    const extractor = document.querySelector('[data-extract-single]') as any;
                                    if (extractor) extractor.click();
                                  }
                                }}
                                title={rect.hasData ? 'Data extracted ✓' : 'Click to extract data'}
                              >
                                {rect.isExtracting && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="bg-white rounded-full p-2 shadow-lg">
                                      <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                                    </div>
                                  </div>
                                )}
                                {rect.hasData && rect.extractedData && (
                                  <div className="absolute top-1 left-1 bg-green-500 text-white text-[8px] px-1 py-0.5 rounded font-semibold">
                                    ✓ {rect.extractedData.meter_number || 'Data'}
                                  </div>
                                )}
                                {!rect.hasData && !rect.isExtracting && (
                                  <div className="absolute top-1 left-1 bg-red-500 text-white text-[8px] px-1 py-0.5 rounded font-semibold">
                                    No Data
                                  </div>
                                )}
                              </div>
                            ))}
                            
                            {/* Current Drawing Rectangle */}
                            {isDrawingMode && currentDrawRect && currentDrawRect.width > 0 && currentDrawRect.height > 0 && (
                              <div
                                className="absolute border-3 border-primary rounded-md pointer-events-none"
                                style={{
                                  left: `${currentDrawRect.left}%`,
                                  top: `${currentDrawRect.top}%`,
                                  width: `${currentDrawRect.width}%`,
                                  height: `${currentDrawRect.height}%`,
                                  backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                  zIndex: 40,
                                }}
                              >
                                <div className="absolute -top-8 left-0 bg-primary text-primary-foreground px-2 py-1 rounded text-xs font-medium">
                                  Drawing region...
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="relative inline-block max-h-full">
                            <img
                              ref={imageRef}
                              src={imageUrl}
                              alt={schematic.name}
                              className="max-w-full max-h-full w-auto h-auto object-contain"
                              draggable={false}
                              onLoad={() => {
                                setImageLoaded(true);
                                console.log('Image loaded');
                              }}
                            />
                            
                            {/* Connection Lines for regular images */}
                            <svg 
                              className="absolute inset-0 pointer-events-none"
                              style={{ 
                                width: '100%', 
                                height: '100%',
                                zIndex: 20
                              }}
                            >
                              {meterConnections.map((connection) => {
                                const childPos = meterPositions.find(p => p.meter_id === connection.child_meter_id);
                                const parentPos = meterPositions.find(p => p.meter_id === connection.parent_meter_id);
                                
                                if (!childPos || !parentPos || !imageRef.current) return null;
                                
                                return (
                                  <line
                                    key={connection.id}
                                    x1={`${childPos.x_position}%`}
                                    y1={`${childPos.y_position}%`}
                                    x2={`${parentPos.x_position}%`}
                                    y2={`${parentPos.y_position}%`}
                                    stroke="#3b82f6"
                                    strokeWidth="3"
                                    opacity="0.7"
                                  />
                                );
                              })}
                            </svg>

                            {/* Meter markers for regular images */}
                            {meterPositions.map((position) => (
                              <div
                                key={position.id}
                                className="meter-marker absolute rounded-full border-3 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-all"
                                style={{
                                  left: `${position.x_position}%`,
                                  top: `${position.y_position}%`,
                                  transform: "translate(-50%, -50%)",
                                  transformOrigin: 'center center',
                                  width: '28px',
                                  height: '28px',
                                  backgroundColor: position.meters?.meter_type === 'council_bulk' ? 'hsl(var(--primary))' :
                                                  position.meters?.meter_type === 'check_meter' ? '#f59e0b' :
                                                  '#8b5cf6',
                                  zIndex: 30,
                                }}
                                title={`${position.meters?.meter_number} - ${position.label || ""}`}
                              >
                                <span className="text-[9px] font-bold text-white leading-none">{position.meters?.meter_number?.substring(0, 3)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meter Details Side Panel - Only show when meters extracted */}
                  {meterPositions.length > 0 && (
                    <div className="flex flex-col overflow-hidden">
                      <div className="overflow-y-auto space-y-4 pr-2">
                      {selectedMeterIndex !== null ? (
                        <Card className="border-border/50 sticky top-4">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center justify-between">
                              <span>Meter #{selectedMeterIndex + 1}</span>
                              <Badge 
                                variant={
                                  extractedMeters[selectedMeterIndex].status === 'approved' ? 'default' : 
                                  extractedMeters[selectedMeterIndex].status === 'rejected' ? 'destructive' : 
                                  'secondary'
                                }
                              >
                                {extractedMeters[selectedMeterIndex].status || 'pending'}
                              </Badge>
                            </CardTitle>
                            <CardDescription className="font-mono text-sm">
                              {extractedMeters[selectedMeterIndex].meter_number}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {isEditingMeter && editedMeterData ? (
                              // Edit Mode
                              <div className="space-y-3">
                                <div>
                                  <Label className="text-xs">Meter Number</Label>
                                  <Input
                                    value={editedMeterData.meter_number}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, meter_number: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Name</Label>
                                  <Input
                                    value={editedMeterData.name}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, name: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">Area (m²)</Label>
                                    <Input
                                      type="number"
                                      value={editedMeterData.area}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, area: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Rating</Label>
                                    <Input
                                      value={editedMeterData.rating}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, rating: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">Cable Specification</Label>
                                  <Input
                                    value={editedMeterData.cable_specification}
                                    onChange={(e) => setEditedMeterData({ ...editedMeterData, cable_specification: e.target.value })}
                                    className="text-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">Serial Number</Label>
                                    <Input
                                      value={editedMeterData.serial_number}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, serial_number: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">CT Type</Label>
                                    <Input
                                      value={editedMeterData.ct_type}
                                      onChange={(e) => setEditedMeterData({ ...editedMeterData, ct_type: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-2">
                                  <Button onClick={handleSaveEdit} size="sm" className="flex-1">
                                    <Check className="h-4 w-4 mr-1" />
                                    Save
                                  </Button>
                                  <Button onClick={handleCancelEdit} size="sm" variant="outline" className="flex-1">
                                    <X className="h-4 w-4 mr-1" />
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              // View Mode
                              <>
                            {/* Structured meter info table like reference image */}
                            <div className="border-2 border-foreground/80 rounded overflow-hidden bg-background">
                              <div className="grid grid-cols-[100px_1fr]">
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">NO:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 font-medium text-sm">{extractedMeters[selectedMeterIndex].meter_number}</div>
                                
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">NAME:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 text-sm font-medium">{extractedMeters[selectedMeterIndex].name || 'N/A'}</div>
                                
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">AREA:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 text-sm">{extractedMeters[selectedMeterIndex].area || 'N/A'}</div>
                                
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">RATING:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 text-sm">{extractedMeters[selectedMeterIndex].rating || 'N/A'}</div>
                                
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">CABLE:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 text-sm">{extractedMeters[selectedMeterIndex].cable_specification || 'N/A'}</div>
                                
                                <div className="px-3 py-2.5 border-b-2 border-r-2 border-foreground/80 font-bold text-sm">SERIAL:</div>
                                <div className="px-3 py-2.5 border-b-2 border-foreground/80 text-sm">{extractedMeters[selectedMeterIndex].serial_number || 'N/A'}</div>
                                
                                <div className="px-3 py-2.5 border-r-2 border-foreground/80 font-bold text-sm">CT:</div>
                                <div className="px-3 py-2.5 text-sm">{extractedMeters[selectedMeterIndex].ct_type || 'N/A'}</div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 pt-2">
                              <Button
                                onClick={handleStartEdit}
                                variant="outline"
                                size="sm"
                                className="w-full"
                              >
                                <Edit className="h-4 w-4 mr-2" />
                                Edit Meter Data
                              </Button>
                              {extractedMeters[selectedMeterIndex].status !== 'approved' && (
                                <Button
                                  onClick={() => {
                                    const updated = [...extractedMeters];
                                    updated[selectedMeterIndex].status = 'approved';
                                    setExtractedMeters(updated);
                                    toast.success(`Approved: ${updated[selectedMeterIndex].meter_number}`);
                                  }}
                                  className="w-full bg-green-600 hover:bg-green-700"
                                  size="sm"
                                >
                                  <Check className="h-4 w-4 mr-2" />
                                  Approve Meter
                                </Button>
                              )}
                              <Button
                                onClick={() => {
                                  if (selectedMeterIndex === null) return;
                                  const meterToDelete = extractedMeters[selectedMeterIndex];
                                  const updated = extractedMeters.filter((_, i) => i !== selectedMeterIndex);
                                  setExtractedMeters(updated);
                                  setSelectedMeterIndex(null);
                                  toast.success(`Deleted meter: ${meterToDelete.meter_number}`);
                                }}
                                variant="destructive"
                                size="sm"
                                className="w-full"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Meter
                              </Button>
                            </div>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      ) : (
                        <Card className="border-border/50">
                          <CardContent className="p-8 text-center text-muted-foreground">
                            <p className="text-sm">Click on a meter marker to review details</p>
                          </CardContent>
                        </Card>
                      )}

                      {/* Summary Card */}
                      <Card className="border-border/50">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm">Progress</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Meters</span>
                            <span className="font-medium">{extractedMeters.length}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Approved</span>
                            <span className="font-medium text-green-600">
                              {extractedMeters.filter(m => m.status === 'approved').length}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Rejected</span>
                            <span className="font-medium text-red-600">
                              {extractedMeters.filter(m => m.status === 'rejected').length}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                  )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
