import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import { Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { lazyWithPreload } from "react-lazy-with-preload";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Loader from "@/components/ui/loader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AnalyticsSearchSchema } from "@/routes/_protected/w.$workspaceId/outreach/sequences/$id.index";

type Period = "7d" | "30d" | "90d" | "custom";
type ViewMode = "sendDate" | "eventDate";
type Grouping = "day" | "week" | "month";

const AnalyticsParamsSchema = AnalyticsSearchSchema;

type AnalyticsParams = z.infer<typeof AnalyticsParamsSchema>;
const DEFAULT_PARAMS = AnalyticsParamsSchema.parse({});

interface SequenceAnalyticsDialogProps {
  workspaceId: string;
  sequenceId: string;
  children: React.ReactNode;
  params: AnalyticsParams | undefined;
  onParamsChange: (params: AnalyticsParams | undefined) => void;
}

const computeDefaultRanges = () => {
  const now = new Date();
  return {
    "7d": { from: subDays(now, 7), to: now },
    "30d": { from: subDays(now, 30), to: now },
    "90d": { from: subDays(now, 90), to: now },
  };
};

const LazyChart = lazyWithPreload(() =>
  import("./sequence-analytics-chart").then((module) => ({
    default: module.SequenceAnalyticsChart,
  }))
);

export function SequenceAnalyticsDialog({
  workspaceId,
  sequenceId,
  children,
  params,
  onParamsChange,
}: SequenceAnalyticsDialogProps) {
  const { t } = useTranslation();
  const trpc = useTRPC();

  const isWideScreen = useBreakpoint("md");

  const open = !!params;
  const period: Period = params?.period ?? DEFAULT_PARAMS.period;
  const viewMode: ViewMode = params?.viewMode ?? DEFAULT_PARAMS.viewMode;
  const grouping: Grouping = params?.grouping ?? DEFAULT_PARAMS.grouping;
  const defaultRanges = useMemo(computeDefaultRanges, [open]);
  const dateRange =
    params?.period === "custom" && params.customFrom && params.customTo
      ? { from: new Date(params.customFrom), to: new Date(params.customTo) }
      : (defaultRanges[params?.period as keyof typeof defaultRanges] ??
        defaultRanges[DEFAULT_PARAMS.period as keyof typeof defaultRanges]);

  const updateParams = (updates: Partial<AnalyticsParams>) => {
    console.log(updates);
    onParamsChange(AnalyticsParamsSchema.parse({ ...params, ...updates }));
  };

  const setOpen = (value: boolean) => {
    onParamsChange(value ? DEFAULT_PARAMS : undefined);
  };

  const { data, isLoading } = useQuery(
    trpc.outreach.getSequenceAnalytics.queryOptions(
      {
        workspaceId,
        sequenceId,
        startDate: dateRange.from.toISOString(),
        endDate: dateRange.to.toISOString(),
        viewMode,
        grouping,
      },
      {
        enabled: open,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
      }
    )
  );

  useEffect(() => {
    LazyChart.preload();
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t("web.outreach.sequences.analytics.title")}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="card"
                  size="xs"
                  className={cn(
                    "justify-start rounded-full px-3 text-left font-normal"
                  )}
                >
                  <span className="text-muted-foreground">
                    {t("web.outreach.sequences.analytics.period.label")}
                  </span>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="font-medium">
                    {period === "custom" ? (
                      <>
                        {format(dateRange.from, "MMM d, yyyy")} -{" "}
                        {format(dateRange.to, "MMM d, yyyy")}
                      </>
                    ) : (
                      <span>
                        {t(`web.outreach.sequences.analytics.period.${period}`)}
                      </span>
                    )}
                  </span>
                  <ChevronDownIcon className="size-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="flex">
                  <div className="border-r p-2">
                    <div className="flex flex-col gap-1">
                      <Button
                        variant={period === "7d" ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => {
                          updateParams({
                            period: "7d",
                            customFrom: subDays(new Date(), 7).toISOString(),
                            customTo: new Date().toISOString(),
                          });
                        }}
                      >
                        {t("web.outreach.sequences.analytics.period.7d")}
                      </Button>
                      <Button
                        variant={period === "30d" ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => {
                          updateParams({
                            period: "30d",
                            customFrom: subDays(new Date(), 30).toISOString(),
                            customTo: new Date().toISOString(),
                          });
                        }}
                      >
                        {t("web.outreach.sequences.analytics.period.30d")}
                      </Button>
                      <Button
                        variant={period === "90d" ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => {
                          updateParams({
                            period: "90d",
                            customFrom: subDays(new Date(), 90).toISOString(),
                            customTo: new Date().toISOString(),
                          });
                        }}
                      >
                        {t("web.outreach.sequences.analytics.period.90d")}
                      </Button>
                      <Button
                        variant={period === "custom" ? "secondary" : "ghost"}
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => updateParams({ period: "custom" })}
                      >
                        {t("web.outreach.sequences.analytics.period.custom")}
                      </Button>
                    </div>
                  </div>
                  <div className="p-2">
                    <Calendar
                      mode="range"
                      defaultMonth={dateRange.from}
                      selected={dateRange}
                      onSelect={(range) => {
                        if (range) {
                          updateParams({
                            period: "custom",
                            customFrom: range.from?.toISOString(),
                            customTo: range.to?.toISOString(),
                          });
                        }
                      }}
                      numberOfMonths={isWideScreen ? 2 : 1}
                      disabled={(date) => date > new Date()}
                      initialFocus
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="card"
                  size="xs"
                  className="rounded-full px-3 font-normal"
                >
                  <span className="font-medium">
                    {t(`web.outreach.sequences.analytics.grouping.${grouping}`)}
                  </span>
                  <ChevronDownIcon className="size-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={grouping}
                  onValueChange={(v) =>
                    updateParams({ grouping: v as Grouping })
                  }
                >
                  {(["day", "week", "month"] as const).map((g) => (
                    <DropdownMenuRadioItem key={g} value={g}>
                      {t(`web.outreach.sequences.analytics.grouping.${g}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View Mode */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="card"
                  size="xs"
                  className="rounded-full px-3 font-normal sm:ml-auto"
                >
                  <span className="text-muted-foreground">
                    {t("web.outreach.sequences.analytics.viewMode.label")}
                  </span>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="font-medium">
                    {t(`web.outreach.sequences.analytics.viewMode.${viewMode}`)}
                  </span>
                  <ChevronDownIcon className="size-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px]">
                <DropdownMenuRadioGroup
                  value={viewMode}
                  onValueChange={(v) =>
                    updateParams({ viewMode: v as ViewMode })
                  }
                >
                  <DropdownMenuRadioItem
                    value="sendDate"
                    className="flex flex-col items-start px-2 py-2"
                  >
                    <span className="mb-1 font-medium">
                      {t("web.outreach.sequences.analytics.viewMode.sendDate")}
                    </span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {t(
                        "web.outreach.sequences.analytics.viewMode.sendDateTooltip"
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="eventDate"
                    className="flex flex-col items-start px-2 py-2"
                  >
                    <span className="mb-1 font-medium">
                      {t("web.outreach.sequences.analytics.viewMode.eventDate")}
                    </span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {t(
                        "web.outreach.sequences.analytics.viewMode.eventDateTooltip"
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Chart */}
          <div
            className={cn(
              "min-h-[300px] w-full overflow-hidden rounded-lg transition-colors",
              isLoading && "bg-card animate-pulse"
            )}
          >
            {data && data.dataPoints.length > 0 ? (
              <Suspense fallback={<Loader />}>
                <LazyChart data={data} />
              </Suspense>
            ) : data && data.dataPoints.length === 0 ? (
              <div className="text-muted-foreground flex h-full min-h-[200px] items-center justify-center text-sm">
                {t("web.outreach.sequences.analytics.noData")}
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
