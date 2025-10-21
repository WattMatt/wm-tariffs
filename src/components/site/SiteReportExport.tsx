import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface Site {
  id: string;
  name: string;
  address: string | null;
  council_connection_point: string | null;
  clients: { name: string; code: string } | null;
  supply_authorities: { name: string; region: string } | null;
}

interface SiteReportExportProps {
  site: Site;
}

export default function SiteReportExport({ site }: SiteReportExportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const generateReport = async () => {
    setIsGenerating(true);
    try {
      // Fetch all data
      const [metersData, schematicsData, connectionsData] = await Promise.all([
        supabase.from("meters").select("*").eq("site_id", site.id).order("meter_type, meter_number"),
        supabase.from("schematics").select("*").eq("site_id", site.id).order("created_at"),
        supabase.from("meter_connections").select("id, connection_type, parent_meter_id, child_meter_id").order("created_at")
      ]);

      // Fetch meter details separately
      const meterIds = [...new Set([
        ...(connectionsData.data || []).map(c => c.parent_meter_id),
        ...(connectionsData.data || []).map(c => c.child_meter_id)
      ])];
      
      const { data: connectionMetersData } = await supabase
        .from("meters")
        .select("id, meter_number, name")
        .in("id", meterIds);
      
      const meterMap = new Map((connectionMetersData || []).map(m => [m.id, m]));

      const meters = metersData.data || [];
      const schematics = schematicsData.data || [];
      const connections = (connectionsData.data || []).map(conn => ({
        ...conn,
        parent: meterMap.get(conn.parent_meter_id),
        child: meterMap.get(conn.child_meter_id)
      }));

      // Create temporary container for HTML rendering
      const tempContainer = document.createElement("div");
      tempContainer.style.position = "absolute";
      tempContainer.style.left = "-9999px";
      tempContainer.style.width = "794px"; // A4 width in pixels at 96 DPI
      tempContainer.style.background = "#fff";
      tempContainer.style.padding = "40px";
      
      // Generate HTML content
      tempContainer.innerHTML = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
    <div style="border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 40px;">
      <h1 style="font-size: 32px; color: #1a1a1a; margin-bottom: 8px;">${site.name}</h1>
      <div style="font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 1px;">Site Comprehensive Report</div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 40px; background: #f8fafc; padding: 20px; border-radius: 8px;">
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Client</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${site.clients?.name || "—"} ${site.clients?.code ? `(${site.clients.code})` : ""}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Address</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${site.address || "—"}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Council Connection Point</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${site.council_connection_point || "—"}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Supply Authority</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${site.supply_authorities?.name || "—"}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Report Generated</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${format(new Date(), "dd MMM yyyy, HH:mm")}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Total Meters</div>
        <div style="font-size: 16px; color: #1a1a1a; font-weight: 500;">${meters.length}</div>
      </div>
    </div>

    <div style="margin-bottom: 40px;">
      <h2 style="font-size: 24px; color: #1a1a1a; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">Meters Overview</h2>
      ${meters.length === 0 ? `
        <div style="padding: 40px; text-align: center; color: #666; background: #f8fafc; border-radius: 8px;">No meters registered</div>
      ` : `
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead style="background: #f8fafc;">
            <tr>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Meter No.</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Name</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Type</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Rating</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Critical</th>
            </tr>
          </thead>
          <tbody>
            ${meters.map(meter => `
              <tr>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;"><strong>${meter.meter_number}</strong></td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${meter.name || "—"}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${meter.meter_type.replace(/_/g, ' ')}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${meter.rating || "—"}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${meter.is_revenue_critical ? '✓' : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div style="margin-bottom: 40px;">
      <h2 style="font-size: 24px; color: #1a1a1a; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">Meter Connections</h2>
      ${connections.length === 0 ? `
        <div style="padding: 40px; text-align: center; color: #666; background: #f8fafc; border-radius: 8px;">No connections configured</div>
      ` : `
        ${connections.map(conn => `
          <div style="padding: 12px; background: #f8fafc; border-left: 4px solid #2563eb; margin-bottom: 8px; border-radius: 4px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 4px;">${conn.connection_type.replace(/_/g, ' ')}</div>
            <div style="font-size: 14px; color: #1a1a1a;"><strong>${conn.parent?.meter_number || '?'}</strong> → <strong>${conn.child?.meter_number || '?'}</strong></div>
          </div>
        `).join('')}
      `}
    </div>

    <div style="margin-bottom: 40px;">
      <h2 style="font-size: 24px; color: #1a1a1a; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">Schematics</h2>
      ${schematics.length === 0 ? `
        <div style="padding: 40px; text-align: center; color: #666; background: #f8fafc; border-radius: 8px;">No schematics uploaded</div>
      ` : `
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead style="background: #f8fafc;">
            <tr>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Name</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Type</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Pages</th>
              <th style="text-align: left; padding: 10px; font-weight: 600; border-bottom: 2px solid #e5e7eb;">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            ${schematics.map(schematic => `
              <tr>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;"><strong>${schematic.name}</strong></td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${schematic.file_type.toUpperCase()}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${schematic.page_number}/${schematic.total_pages}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f5f9;">${format(new Date(schematic.created_at), "dd MMM yyyy")}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <div style="margin-top: 60px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 12px;">
      <p>Generated on ${format(new Date(), "dd MMMM yyyy 'at' HH:mm")}</p>
    </div>
  </div>
      `;

      document.body.appendChild(tempContainer);

      // Convert HTML to canvas
      const canvas = await html2canvas(tempContainer, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff"
      });

      document.body.removeChild(tempContainer);

      // Create PDF
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if content is longer
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Download PDF
      pdf.save(`${site.name.replace(/[^a-z0-9]/gi, '_')}_Report_${format(new Date(), "yyyy-MM-dd")}.pdf`);

      toast.success("PDF report generated successfully");
      setIsOpen(false);
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Failed to generate report");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        <FileDown className="w-4 h-4 mr-2" />
        Export Report
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Site Report</DialogTitle>
            <DialogDescription>
              Generate a comprehensive PDF report including site details, meters, connections, and schematics.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">Report includes:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Site information and details</li>
                <li>Complete meters inventory</li>
                <li>Meter connections and hierarchy</li>
                <li>Schematics documentation</li>
                <li>Professional formatting for printing</li>
              </ul>
            </div>
            <Button 
              onClick={generateReport} 
              disabled={isGenerating}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 mr-2" />
                  Generate & Download PDF
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}