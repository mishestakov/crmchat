import {
  CheckCheckIcon,
  CheckIcon,
  MessageCircleReplyIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  CustomTooltipProps,
} from "@/components/ui/chart";
import { RouterOutput } from "@/lib/trpc";

export function SequenceAnalyticsChart({
  data,
}: {
  data: RouterOutput["outreach"]["getSequenceAnalytics"];
}) {
  const { t } = useTranslation();
  return (
    <ChartContainer
      config={{
        sent: {
          label: t("web.outreach.sequences.analytics.chart.sent"),
          color: "hsl(var(--primary))",
          icon: CheckIcon,
        },
        read: {
          label: t("web.outreach.sequences.analytics.chart.read"),
          color: "hsl(142 76% 36%)",
          icon: CheckCheckIcon,
        },
        replied: {
          label: t("web.outreach.sequences.analytics.chart.replied"),
          color: "hsl(271 91% 65%)",
          icon: MessageCircleReplyIcon,
        },
      }}
      className="bg-card size-full"
    >
      <LineChart
        accessibilityLayer
        data={data.dataPoints}
        margin={{
          left: 12,
          right: 12,
          bottom: 12,
          top: 12,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value) => {
            const date = new Date(value);
            if (data.grouping === "month") {
              return date.toLocaleDateString("en-US", {
                month: "short",
              });
            }
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <YAxis
          width="auto"
          className="text-xs"
          type="number"
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={(props: CustomTooltipProps) => (
            <ChartTooltipContent {...props} />
          )}
          labelFormatter={(value) => {
            const date = new Date(value);
            if (data.grouping === "month") {
              return date.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              });
            }
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
          }}
        />
        <ChartLegend
          itemSorter={(item) =>
            ["sent", "read", "replied"].indexOf(String(item?.dataKey))
          }
          content={<ChartLegendContent />}
        />

        <Line
          type="monotone"
          dataKey="sent"
          name={t("web.outreach.sequences.analytics.chart.sent")}
          stroke="var(--color-sent)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="read"
          name={t("web.outreach.sequences.analytics.chart.read")}
          stroke="var(--color-read)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="replied"
          name={t("web.outreach.sequences.analytics.chart.replied")}
          stroke="var(--color-replied)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
