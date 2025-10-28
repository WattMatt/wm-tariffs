import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

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
    confirmation_status?: string;
  };
  showLocationAndTariff?: boolean;
}

export function MeterFormFields({ 
  idPrefix, 
  defaultValues, 
  showLocationAndTariff = false
}: MeterFormFieldsProps) {
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

  return (
    <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_meter_number`}>NO (Meter Number) *</Label>
          <Input 
            id={`${idPrefix}_meter_number`}
            name="meter_number" 
            required 
            defaultValue={cleanValue(defaultValues.meter_number)}
            placeholder="DB-03"
            className={hasNotVisible(defaultValues.meter_number) ? 'border-orange-500' : ''}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_name`}>NAME *</Label>
          <Input 
            id={`${idPrefix}_name`}
            name="name" 
            required 
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
          <Label htmlFor={`${idPrefix}_rating`}>RATING *</Label>
          <Input 
            id={`${idPrefix}_rating`}
            name="rating" 
            required 
            defaultValue={cleanValue(defaultValues.rating)}
            placeholder="80A TP"
          />
        </div>

        <div className="space-y-2 col-span-2">
          <Label htmlFor={`${idPrefix}_cable_specification`}>
            {showLocationAndTariff ? 'CABLE' : 'CABLE SPECIFICATION'} *
          </Label>
          <Input 
            id={`${idPrefix}_cable_specification`}
            name="cable_specification" 
            required 
            defaultValue={cleanValue(defaultValues.cable_specification)}
            placeholder="4C x 16mm² ALU ECC CABLE"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_serial_number`} className="flex items-center gap-2">
            {showLocationAndTariff ? 'SERIAL' : 'SERIAL NUMBER'} * 
            {!showLocationAndTariff && (
              <Badge variant="destructive" className="text-xs">VERIFY TWICE</Badge>
            )}
          </Label>
          <Input 
            id={`${idPrefix}_serial_number`}
            name="serial_number" 
            required 
            defaultValue={cleanValue(defaultValues.serial_number)}
            placeholder="34020113A"
            className={`font-mono text-lg ${!showLocationAndTariff ? 'border-red-300 focus:border-red-500' : ''} ${hasNotVisible(defaultValues.serial_number) ? 'border-orange-500' : ''}`}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_ct_type`}>
            {showLocationAndTariff ? 'CT' : 'CT TYPE'} *
          </Label>
          <Input 
            id={`${idPrefix}_ct_type`}
            name="ct_type" 
            required 
            defaultValue={cleanValue(defaultValues.ct_type)}
            placeholder="DOL or 150/5A"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_meter_type`}>
            {showLocationAndTariff ? 'Meter Type' : 'METER TYPE'} *
          </Label>
          <Select name="meter_type" required defaultValue={defaultValues.meter_type || 'tenant_meter'}>
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
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}_confirmation_status`}>Confirmation Status</Label>
          <Select name="confirmation_status" defaultValue={defaultValues.confirmation_status || 'unconfirmed'}>
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
              <Input 
                id={`${idPrefix}_tariff`}
                name="tariff" 
                defaultValue={defaultValues.tariff || ''}
                placeholder="Business Standard" 
              />
            </div>
          </>
        )}
      </div>
  );
}
