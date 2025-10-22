import * as React from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  showTime?: boolean;
  onTimeChange?: (time: string) => void;
  defaultTime?: string;
};

function Calendar({ 
  className, 
  classNames, 
  showOutsideDays = true, 
  showTime = false,
  onTimeChange,
  defaultTime = "00:00",
  ...props 
}: CalendarProps) {
  const [month, setMonth] = React.useState<Date>(props.selected as Date || new Date());
  const [time, setTime] = React.useState(defaultTime);

  const currentYear = month.getFullYear();
  const currentMonth = month.getMonth();

  const years = Array.from({ length: 100 }, (_, i) => currentYear - 50 + i);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const handleMonthChange = (value: string) => {
    const newMonth = new Date(month);
    newMonth.setMonth(parseInt(value));
    setMonth(newMonth);
  };

  const handleYearChange = (value: string) => {
    const newMonth = new Date(month);
    newMonth.setFullYear(parseInt(value));
    setMonth(newMonth);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTime(e.target.value);
    onTimeChange?.(e.target.value);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 px-3 pt-3">
        <Select value={currentMonth.toString()} onValueChange={handleMonthChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((monthName, index) => (
              <SelectItem key={index} value={index.toString()}>
                {monthName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={currentYear.toString()} onValueChange={handleYearChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DayPicker
        month={month}
        onMonthChange={setMonth}
        showOutsideDays={showOutsideDays}
        className={cn("p-3 pt-0", className)}
        classNames={{
          months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          caption: "hidden",
          caption_label: "hidden",
          nav: "hidden",
          nav_button: "hidden",
          nav_button_previous: "hidden",
          nav_button_next: "hidden",
          table: "w-full border-collapse space-y-1",
          head_row: "flex",
          head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
          day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
          day_range_end: "day-range-end",
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
          day_today: "bg-accent text-accent-foreground",
          day_outside:
            "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        {...props}
      />

      {showTime && (
        <div className="px-3 pb-3 space-y-2">
          <label className="text-sm font-medium">Time</label>
          <div className="relative">
            <Input
              type="time"
              value={time}
              onChange={handleTimeChange}
              className="pr-10"
            />
            <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      )}
    </div>
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
