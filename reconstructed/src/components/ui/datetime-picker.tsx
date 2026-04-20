"use client";

import { addYears, format, subYears } from "date-fns";
import { CalendarIcon, Loader } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { lazyWithPreload } from "react-lazy-with-preload";

import { Input } from "./input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const CalendarLazy = lazyWithPreload(() =>
  import("@/components/ui/calendar").then((mod) => ({
    default: mod.Calendar,
  }))
);

export function DateTimePicker({
  value,
  onChange,
}: {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
}) {
  const { t } = useTranslation();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  useEffect(() => {
    CalendarLazy.preload();
  }, []);
  return (
    <div className="flex flex-row items-center gap-2">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={"outline"}
            className={cn(
              "bg-card grow justify-start px-3 text-left font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="size-4" />
            <span>
              {value ? format(value, "PPP") : t("web.dateTimePicker.pickDate")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="pointer-events-auto w-auto p-0">
          <Suspense fallback={<Loader />}>
            <CalendarLazy
              mode="single"
              selected={value}
              defaultMonth={value ?? new Date()}
              onSelect={(date) => {
                if (!date) {
                  onChange(undefined);
                  return;
                }

                // copy time from previous value
                const newDate = new Date(date);
                newDate.setHours(
                  value?.getHours() ?? 10,
                  value?.getMinutes() ?? 0,
                  0
                );
                onChange(newDate);
                setIsCalendarOpen(false);
              }}
              autoFocus
              startMonth={subYears(new Date(), 20)}
              endMonth={addYears(new Date(), 20)}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
      <span className="text-sm">{t("web.dateTimePicker.at")}</span>
      <div className="shrink">
        <Input
          className="min-w-[120px]"
          type="time"
          value={value ? format(value, "HH:mm") : ""}
          onChange={(e) => {
            const [hours, minutes] = e.target.value.split(":");
            const newDate = new Date(value ?? new Date());
            newDate.setHours(Number.parseInt(hours!, 10));
            newDate.setMinutes(Number.parseInt(minutes!, 10));
            onChange(newDate);
          }}
        />
      </div>
    </div>
  );
}
