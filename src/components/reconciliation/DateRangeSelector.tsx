import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface DateRangeSelectorProps {
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  timeFrom: string;
  timeTo: string;
  isDateFromOpen: boolean;
  isDateToOpen: boolean;
  onDateFromChange: (date: Date | undefined) => void;
  onDateToChange: (date: Date | undefined) => void;
  onTimeFromChange: (time: string) => void;
  onTimeToChange: (time: string) => void;
  onDateFromOpenChange: (open: boolean) => void;
  onDateToOpenChange: (open: boolean) => void;
  onUserSetDates: () => void;
}

export function DateRangeSelector({
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  isDateFromOpen,
  isDateToOpen,
  onDateFromChange,
  onDateToChange,
  onTimeFromChange,
  onTimeToChange,
  onDateFromOpenChange,
  onDateToOpenChange,
  onUserSetDates,
}: DateRangeSelectorProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>From Date & Time</Label>
        <Popover open={isDateFromOpen} onOpenChange={onDateFromOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !dateFrom && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? `${format(dateFrom, "PP")} at ${timeFrom}` : "Pick date & time"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
            <div>
              <Calendar 
                mode="single" 
                selected={dateFrom} 
                onSelect={(date) => {
                  onDateFromChange(date);
                  onUserSetDates();
                }}
                className={cn("p-3 pointer-events-auto")}
                disabled={false}
                fromYear={2000}
                toYear={2050}
                captionLayout="dropdown-buttons"
              />
              <div className="px-3 pb-3">
                <Input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => {
                    onTimeFromChange(e.target.value);
                    onUserSetDates();
                  }}
                  onBlur={() => {
                    if (timeFrom && timeFrom.length === 5) {
                      setTimeout(() => onDateFromOpenChange(false), 100);
                    }
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        <Label>To Date & Time</Label>
        <Popover open={isDateToOpen} onOpenChange={onDateToOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !dateTo && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? `${format(dateTo, "PP")} at ${timeTo}` : "Pick date & time"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-popover z-50" align="start">
            <div>
              <Calendar 
                mode="single" 
                selected={dateTo} 
                onSelect={(date) => {
                  onDateToChange(date);
                  onUserSetDates();
                }}
                className={cn("p-3 pointer-events-auto")}
                disabled={false}
                fromYear={2000}
                toYear={2050}
                captionLayout="dropdown-buttons"
              />
              <div className="px-3 pb-3">
                <Input
                  type="time"
                  value={timeTo}
                  onChange={(e) => {
                    onTimeToChange(e.target.value);
                    onUserSetDates();
                  }}
                  onBlur={() => {
                    if (timeTo && timeTo.length === 5) {
                      setTimeout(() => onDateToOpenChange(false), 100);
                    }
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
