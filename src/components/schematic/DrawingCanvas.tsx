import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas, Polygon, FabricImage } from "fabric";
import { toast } from "sonner";

interface DrawingCanvasProps {
  imageUrl: string;
  isDrawingMode: boolean;
  onRegionDrawn: (region: { bounds: { left: number; top: number; width: number; height: number } }) => void;
  onExitDrawing: () => void;
}

export const DrawingCanvas = ({ imageUrl, isDrawingMode, onRegionDrawn, onExitDrawing }: DrawingCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [currentPolygon, setCurrentPolygon] = useState<Polygon | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 800,
      height: 600,
      selection: false,
    });

    // Load background image
    FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" }).then((img) => {
      const canvasAspect = 800 / 600;
      const imgAspect = (img.width || 800) / (img.height || 600);
      
      let scale;
      if (imgAspect > canvasAspect) {
        scale = 800 / (img.width || 800);
      } else {
        scale = 600 / (img.height || 600);
      }
      
      img.scale(scale);
      canvas.backgroundImage = img;
      canvas.setDimensions({
        width: (img.width || 800) * scale,
        height: (img.height || 600) * scale
      });
      canvas.renderAll();
    });

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!fabricCanvas || !isDrawingMode) return;

    const handleCanvasClick = (e: any) => {
      const pointer = fabricCanvas.getPointer(e.e);
      const newPoints = [...points, { x: pointer.x, y: pointer.y }];
      setPoints(newPoints);

      // If we have at least 3 points, create/update polygon
      if (newPoints.length >= 3) {
        if (currentPolygon) {
          fabricCanvas.remove(currentPolygon);
        }

        const polygon = new Polygon(newPoints, {
          fill: 'rgba(0, 123, 255, 0.3)',
          stroke: 'rgba(0, 123, 255, 1)',
          strokeWidth: 2,
          selectable: false,
          objectCaching: false,
        });

        fabricCanvas.add(polygon);
        setCurrentPolygon(polygon);
        fabricCanvas.renderAll();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && points.length >= 3) {
        // Complete the region
        const bounds = currentPolygon?.getBoundingRect();
        if (bounds && fabricCanvas.width && fabricCanvas.height) {
          const region = {
            bounds: {
              left: (bounds.left / fabricCanvas.width) * 100,
              top: (bounds.top / fabricCanvas.height) * 100,
              width: (bounds.width / fabricCanvas.width) * 100,
              height: (bounds.height / fabricCanvas.height) * 100,
            }
          };
          
          onRegionDrawn(region);
          
          // Reset
          setPoints([]);
          if (currentPolygon) {
            fabricCanvas.remove(currentPolygon);
            setCurrentPolygon(null);
          }
          onExitDrawing();
        }
      } else if (e.key === 'Escape') {
        // Cancel drawing
        setPoints([]);
        if (currentPolygon) {
          fabricCanvas.remove(currentPolygon);
          setCurrentPolygon(null);
        }
        onExitDrawing();
      }
    };

    fabricCanvas.on('mouse:down', handleCanvasClick);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      fabricCanvas.off('mouse:down', handleCanvasClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fabricCanvas, isDrawingMode, points, currentPolygon, onRegionDrawn, onExitDrawing]);

  if (!isDrawingMode) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 flex flex-col items-center justify-center p-4">
      <div className="bg-card rounded-lg shadow-lg p-4 mb-4">
        <p className="text-sm text-muted-foreground">
          Click to draw a region around the meter. Press <kbd className="px-2 py-1 bg-muted rounded">Enter</kbd> to extract, <kbd className="px-2 py-1 bg-muted rounded">Esc</kbd> to cancel.
        </p>
      </div>
      <div className="border-2 border-primary rounded-lg overflow-hidden shadow-xl">
        <canvas ref={canvasRef} className="max-w-full max-h-[80vh]" />
      </div>
    </div>
  );
};
