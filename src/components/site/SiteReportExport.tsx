import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

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

      // Generate HTML report
      const reportHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Report - ${site.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
      padding: 40px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 40px;
    }
    .header h1 {
      font-size: 32px;
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    .header .subtitle {
      font-size: 14px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .metadata {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 40px;
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
    }
    .metadata-item {
      display: flex;
      flex-direction: column;
    }
    .metadata-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .metadata-value {
      font-size: 16px;
      color: #1a1a1a;
      font-weight: 500;
    }
    .section {
      margin-bottom: 40px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 24px;
      color: #1a1a1a;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
      font-size: 14px;
    }
    thead {
      background: #f8fafc;
    }
    th {
      text-align: left;
      padding: 12px;
      font-weight: 600;
      color: #1a1a1a;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    tr:hover {
      background: #f8fafc;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge-council { background: #dbeafe; color: #1e40af; }
    .badge-check { background: #fef3c7; color: #92400e; }
    .badge-solar { background: #dcfce7; color: #166534; }
    .badge-distribution { background: #f3e8ff; color: #6b21a8; }
    .badge-critical { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .connection-item {
      padding: 12px;
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      margin-bottom: 8px;
      border-radius: 4px;
    }
    .connection-type {
      font-size: 11px;
      text-transform: uppercase;
      color: #666;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .connection-flow {
      font-size: 14px;
      color: #1a1a1a;
    }
    .no-data {
      padding: 40px;
      text-align: center;
      color: #666;
      background: #f8fafc;
      border-radius: 8px;
      font-style: italic;
    }
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    @media print {
      body { padding: 20px; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${site.name}</h1>
    <div class="subtitle">Site Comprehensive Report</div>
  </div>

  <div class="metadata">
    <div class="metadata-item">
      <div class="metadata-label">Client</div>
      <div class="metadata-value">${site.clients?.name || "—"} ${site.clients?.code ? `(${site.clients.code})` : ""}</div>
    </div>
    <div class="metadata-item">
      <div class="metadata-label">Address</div>
      <div class="metadata-value">${site.address || "—"}</div>
    </div>
    <div class="metadata-item">
      <div class="metadata-label">Council Connection Point</div>
      <div class="metadata-value">${site.council_connection_point || "—"}</div>
    </div>
    <div class="metadata-item">
      <div class="metadata-label">Supply Authority</div>
      <div class="metadata-value">
        ${site.supply_authorities?.name || "—"}
        ${site.supply_authorities?.region ? `<br><span style="font-size: 14px; color: #666;">${site.supply_authorities.region}</span>` : ""}
      </div>
    </div>
    <div class="metadata-item">
      <div class="metadata-label">Report Generated</div>
      <div class="metadata-value">${format(new Date(), "dd MMMM yyyy, HH:mm")}</div>
    </div>
    <div class="metadata-item">
      <div class="metadata-label">Total Meters</div>
      <div class="metadata-value">${meters.length}</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Meters Overview</h2>
    ${meters.length === 0 ? `
      <div class="no-data">No meters registered for this site</div>
    ` : `
      <table>
        <thead>
          <tr>
            <th>Meter No.</th>
            <th>Name</th>
            <th>Type</th>
            <th>Area (m²)</th>
            <th>Rating</th>
            <th>Serial Number</th>
            <th>CT Type</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${meters.map(meter => `
            <tr>
              <td><strong>${meter.meter_number}</strong></td>
              <td>${meter.name || "—"}</td>
              <td>
                <span class="badge badge-${meter.meter_type === 'council_bulk' ? 'council' : meter.meter_type === 'check_meter' ? 'check' : meter.meter_type === 'solar' ? 'solar' : 'distribution'}">
                  ${meter.meter_type === 'council_bulk' ? 'Council Bulk' : meter.meter_type === 'check_meter' ? 'Check Meter' : meter.meter_type === 'solar' ? 'Solar' : 'Distribution'}
                </span>
              </td>
              <td>${meter.area || "—"}</td>
              <td><code>${meter.rating || "—"}</code></td>
              <td><code>${meter.serial_number || "—"}</code></td>
              <td>${meter.ct_type || "—"}</td>
              <td>${meter.is_revenue_critical ? '<span class="badge badge-critical">Critical</span>' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="section">
    <h2 class="section-title">Meter Connections & Hierarchy</h2>
    ${connections.length === 0 ? `
      <div class="no-data">No meter connections configured</div>
    ` : `
      ${connections.map(conn => `
        <div class="connection-item">
          <div class="connection-type">${conn.connection_type === 'direct_feed' ? 'Direct Feed' : conn.connection_type === 'sub_distribution' ? 'Sub-Distribution' : 'Backup'}</div>
          <div class="connection-flow">
            <strong>${conn.parent?.meter_number || '?'}</strong> 
            ${conn.parent?.name ? `(${conn.parent.name})` : ''} 
            → 
            <strong>${conn.child?.meter_number || '?'}</strong>
            ${conn.child?.name ? `(${conn.child.name})` : ''}
          </div>
        </div>
      `).join('')}
    `}
  </div>

  <div class="section">
    <h2 class="section-title">Schematics Documentation</h2>
    ${schematics.length === 0 ? `
      <div class="no-data">No schematics uploaded for this site</div>
    ` : `
      <table>
        <thead>
          <tr>
            <th>Schematic Name</th>
            <th>Description</th>
            <th>File Type</th>
            <th>Pages</th>
            <th>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          ${schematics.map(schematic => `
            <tr>
              <td><strong>${schematic.name}</strong></td>
              <td>${schematic.description || "—"}</td>
              <td><code>${schematic.file_type.toUpperCase()}</code></td>
              <td>${schematic.page_number}/${schematic.total_pages}</td>
              <td>${format(new Date(schematic.created_at), "dd MMM yyyy")}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
  </div>

  <div class="section">
    <h2 class="section-title">Reconciliation & Cost Analysis</h2>
    <div class="no-data">
      Reconciliation and cost data must be run for specific date ranges.<br>
      Please use the Reconciliation and Costs tabs in the system to generate specific period reports.
    </div>
  </div>

  <div class="footer">
    <p>This report was generated on ${format(new Date(), "dd MMMM yyyy 'at' HH:mm")}.</p>
    <p>Energy Management System - Site Comprehensive Report</p>
  </div>
</body>
</html>
      `.trim();

      // Create a blob and download
      const blob = new Blob([reportHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${site.name.replace(/[^a-z0-9]/gi, '_')}_Report_${format(new Date(), "yyyy-MM-dd")}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Report generated successfully");
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
              Generate a comprehensive report including site details, meters, connections, and schematics.
              The report will be downloaded as an HTML file that you can view in your browser or print to PDF.
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
                  Generating Report...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 mr-2" />
                  Generate & Download Report
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
