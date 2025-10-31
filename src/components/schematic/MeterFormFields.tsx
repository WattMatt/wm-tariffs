import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface MeterFormFieldsProps {
  idPrefix: string;
  defaultValues: {
    meter_number?: string;
    name?: string;
    area?: string;
    rating?: string;
    cable_specification?: string;
    serial_number?: string;
    ct_type?: string;
    meter_type?: string;
    zone?: string;
    location?: string;
    tariff?: string;
    tariff_structure_id?: string;
    confirmation_status?: string;
  };
  showLocationAndTariff?: boolean;
  siteId?: string;
}

interface TariffStructure {
  id: string;
  name: string;
  tariff_type: string;
}

export function MeterFormFields({ 
  idPrefix, 
  defaultValues, 
  showLocationAndTariff = false,
  siteId
}: MeterFormFieldsProps) {
  const [tariffStructures, setTariffStructures] = useState<TariffStructure[]>([]);
  // Clean VERIFY: and NOT_VISIBLE prefixes from extracted data
  const cleanValue = (value?: string | number) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    return stringValue.replace('VERIFY:', '').replace('NOT_VISIBLE', '');
  };

  const hasNotVisible = (value?: string | number) => {
    if (value === null || value === undefined) return false;
    return String(value).includes('NOT_VISIBLE');
  };

  // State for meter number to allow button to update it
  const [meterNumber, setMeterNumber] = useState(cleanValue(defaultValues.meter_number));

  // Fetch tariff structures for the site's supply authority
  useEffect(() => {
    if (!siteId || !showLocationAndTariff) return;

    const fetchTariffStructures = async () => {
      // First get the site's supply authority
      const { data: siteData } = await supabase
        .from('sites')
        .select('supply_authority_id')
        .eq('id', siteId)
        .single();

      if (!siteData?.supply_authority_id) return;

      // Then fetch active tariff structures for that supply authority
      const { data: tariffs } = await supabase
        .from('tariff_structures')
        .select('id, name, tariff_type')
        .eq('supply_authority_id', siteData.supply_authority_id)
        .eq('active', true)
        .order('name');

      if (tariffs) {
        setTariffStructures(tariffs);
      }
    };

    fetchTariffStructures();
  }, [siteId, showLocationAndTariff]);

  // Generate meter number based on name
  const generateMeterNumber = () => {
    const nameInput = document.getElementById(`${idPrefix}_name`) as HTMLInputElement;
    const meterTypeSelect = document.querySelector(`select[name="meter_type"]`) as HTMLSelectElement;
    const zoneSelect = document.querySelector(`select[name="zone"]`) as HTMLSelectElement;
    
    const name = nameInput?.value || '';
    const meterType = meterTypeSelect?.value || 'tenant_meter';
    const zone = zoneSelect?.value || '';
    
    if (!name) {
      return;
    }
    
    let generatedNumber = '';
    
    // Add zone prefix if available
    if (zone === 'main_board') {
      generatedNumber = 'MB-';
    } else if (zone === 'mini_sub') {
      generatedNumber = 'MS-';
    } else if (zone === 'council') {
      generatedNumber = 'C-';
    }
    
    // Determine prefix based on meter type and name
    if (meterType === 'bulk_meter' || name.toUpperCase().includes('MAIN') || 
        name.toUpperCase().includes('INCOMING') || name.toUpperCase().includes('COUNCIL')) {
      generatedNumber += 'MAIN-01';
    } else if (meterType === 'check_meter' || name.toUpperCase().includes('CHECK')) {
      generatedNumber += 'CHECK-01';
    } else {
      // Use first 2-3 letters of name for tenant meters
      const cleanName = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const prefix = cleanName.substring(0, Math.min(3, cleanName.length));
      generatedNumber += prefix ? `${prefix}-01` : 'METER-01';
    }
    
    setMeterNumber(generatedNumber);
  };

  return (
    <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_meter_number`}>NO (Meter Number) *</Label>
          <div className="flex gap-2">
            <Input 
              id={`${idPrefix}_meter_number`}
              name="meter_number" 
              required 
              value={meterNumber}
              onChange={(e) => setMeterNumber(e.target.value)}
              placeholder="DB-03"
              className={hasNotVisible(defaultValues.meter_number) ? 'border-orange-500' : ''}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={generateMeterNumber}
              className="shrink-0"
              title="Generate meter number from name"
            >
              <Wand2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_name`}>NAME</Label>
        <Input 
          id={`${idPrefix}_name`}
          name="name" 
          defaultValue={cleanValue(defaultValues.name)}
          placeholder="ACKERMANS"
          className={hasNotVisible(defaultValues.name) ? 'border-orange-500' : ''}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_area`}>AREA</Label>
        <Input 
          id={`${idPrefix}_area`}
          name="area" 
          defaultValue={cleanValue(defaultValues.area)}
          placeholder="187m²"
          className={hasNotVisible(defaultValues.area) ? 'border-orange-500' : ''}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_rating`}>RATING</Label>
        <Input 
          id={`${idPrefix}_rating`}
          name="rating" 
          defaultValue={cleanValue(defaultValues.rating)}
          placeholder="80A TP"
        />
      </div>

      <div className="space-y-2 col-span-2">
        <Label htmlFor={`${idPrefix}_cable_specification`}>
          {showLocationAndTariff ? 'CABLE' : 'CABLE SPECIFICATION'}
        </Label>
        <Input 
          id={`${idPrefix}_cable_specification`}
          name="cable_specification" 
          defaultValue={cleanValue(defaultValues.cable_specification)}
          placeholder="4C x 16mm² ALU ECC CABLE"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_serial_number`} className="flex items-center gap-2">
          {showLocationAndTariff ? 'SERIAL' : 'SERIAL NUMBER'}
          {!showLocationAndTariff && (
            <Badge variant="destructive" className="text-xs">VERIFY TWICE</Badge>
          )}
        </Label>
        <div className="flex gap-2">
          <Input 
            id={`${idPrefix}_serial_number`}
            name="serial_number" 
            defaultValue={cleanValue(defaultValues.serial_number)}
            placeholder="34020113A"
            className={`font-mono text-lg ${!showLocationAndTariff ? 'border-red-300 focus:border-red-500' : ''} ${hasNotVisible(defaultValues.serial_number) ? 'border-orange-500' : ''}`}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const serialInput = document.getElementById(`${idPrefix}_serial_number`) as HTMLInputElement;
              if (serialInput) serialInput.value = 'Virtual';
            }}
            className="shrink-0"
            title="Set serial number as Virtual"
          >
            Virtual
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_ct_type`}>
          {showLocationAndTariff ? 'CT' : 'CT TYPE'}
        </Label>
        <Input 
          id={`${idPrefix}_ct_type`}
          name="ct_type" 
          defaultValue={cleanValue(defaultValues.ct_type)}
          placeholder="DOL or 150/5A"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_meter_type`}>
          {showLocationAndTariff ? 'Meter Type' : 'METER TYPE'}
        </Label>
        <Select name="meter_type" defaultValue={defaultValues.meter_type || 'tenant_meter'}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select meter type" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="bulk_meter">Bulk Meter{!showLocationAndTariff && ' (Main Incoming)'}</SelectItem>
              <SelectItem value="check_meter">Check Meter{!showLocationAndTariff && ' (Verification)'}</SelectItem>
              <SelectItem value="tenant_meter">Tenant Meter</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_zone`}>{showLocationAndTariff ? 'Zone' : 'ZONE'}</Label>
          <Select name="zone" defaultValue={defaultValues.zone || ''}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select zone (optional)" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="main_board">Main Board</SelectItem>
              <SelectItem value="mini_sub">Mini Sub</SelectItem>
              <SelectItem value="council">Council</SelectItem>
            </SelectContent>
          </Select>
        </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}_confirmation_status`}>Confirmation Status</Label>
        <Select name="confirmation_status" defaultValue="confirmed">
          <SelectTrigger className="bg-background">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent className="bg-background z-50">
            <SelectItem value="unconfirmed">🔴 Unconfirmed</SelectItem>
            <SelectItem value="confirmed">🟢 Confirmed</SelectItem>
          </SelectContent>
        </Select>
      </div>

        {showLocationAndTariff && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}_location`}>Location</Label>
              <Input 
                id={`${idPrefix}_location`}
                name="location" 
                defaultValue={defaultValues.location || ''}
                placeholder="Building A, Floor 2" 
              />
            </div>

            <div className="space-y-2 col-span-2">
              <Label htmlFor={`${idPrefix}_tariff`}>Tariff</Label>
              <Select 
                name="tariff_structure_id" 
                defaultValue={defaultValues.tariff_structure_id || 'none'}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select tariff structure" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="none">No tariff (optional)</SelectItem>
                  {tariffStructures.map((tariff) => (
                    <SelectItem key={tariff.id} value={tariff.id}>
                      {tariff.name} ({tariff.tariff_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>
  );
}
