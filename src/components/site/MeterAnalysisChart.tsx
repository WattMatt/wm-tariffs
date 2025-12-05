import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

export interface MeterChartDataPoint {
  period: string;
  amount: number;
  documentAmount?: number;
  meterReading?: number;
  isDiscontinuous?: boolean;
  // Seasonal average segments
  [key: string]: number | string | boolean | undefined;
}

interface MeterAnalysisChartProps {
  data: MeterChartDataPoint[];
  metricLabel: string;
  meterNumber: string;
  height?: number;
  showLegend?: boolean;
  showSeasonalAverages?: boolean;
  isConsumptionMetric?: boolean;
  isKvaMetric?: boolean;
  hideDocumentBars?: boolean;
}

/**
 * Reusable chart component that matches the TariffAssignmentTab styling exactly.
 * Used for both UI display and chart capture.
 */
export function MeterAnalysisChart({
  data,
  metricLabel,
  meterNumber,
  height = 400,
  showLegend = true,
  showSeasonalAverages = false,
  isConsumptionMetric = false,
  isKvaMetric = false,
  hideDocumentBars = false,
}: MeterAnalysisChartProps) {
  // Extract seasonal segment keys from data
  const segmentKeys = new Set<string>();
  if (showSeasonalAverages) {
    data.forEach((point) => {
      Object.keys(point).forEach((key) => {
        if (key.startsWith('winterAvg_') || key.startsWith('summerAvg_')) {
          segmentKeys.add(key);
        }
      });
    });
  }

  const chartConfig = {
    amount: {
      label: "Reconciliation Cost",
      color: "hsl(var(--muted-foreground))",
    },
    documentAmount: {
      label: "Document Billed",
      color: "hsl(var(--primary))",
    },
    meterReading: {
      label: "Meter Reading",
      color: "hsl(var(--chart-3))",
    },
    winterAvg: {
      label: "Winter Average",
      color: "hsl(200 100% 40%)",
    },
    summerAvg: {
      label: "Summer Average",
      color: "hsl(25 100% 50%)",
    },
  };

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 80, left: 50, bottom: 70 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11 }}
            angle={-45}
            textAnchor="end"
            height={70}
            label={{
              value: 'Period',
              position: 'insideBottom',
              offset: -5,
              style: { fontSize: 11 },
            }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            label={{
              value: metricLabel,
              angle: -90,
              position: 'insideLeft',
              style: {
                fontSize: 12,
                fontWeight: 600,
                fill: 'hsl(var(--foreground))',
                textAnchor: 'middle',
              },
            }}
            tickFormatter={(value) => {
              if (isConsumptionMetric) {
                return value.toLocaleString();
              }
              return `R${(value / 1000).toFixed(0)}k`;
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            label={{
              value: isKvaMetric ? 'Meter Reading (kVA)' : 'Meter Reading (kWh)',
              angle: 90,
              position: 'insideRight',
              offset: -15,
              style: {
                fontSize: 12,
                fontWeight: 600,
                fill: 'hsl(var(--foreground))',
                textAnchor: 'middle',
              },
            }}
            tickFormatter={(value) => value.toLocaleString()}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {showLegend && (
            <Legend
              wrapperStyle={{ paddingTop: '15px' }}
              iconType="line"
            />
          )}

          {/* Seasonal average lines */}
          {showSeasonalAverages &&
            Array.from(segmentKeys).map((key) => {
              const isWinter = key.startsWith('winterAvg_');
              const color = isWinter ? 'hsl(200 100% 40%)' : 'hsl(25 100% 50%)';

              return (
                <Line
                  key={key}
                  yAxisId="left"
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={3}
                  dot={{ r: 4, fill: color }}
                  connectNulls={false}
                />
              );
            })}

          {/* Reconciliation cost bar */}
          <Bar
            yAxisId="left"
            dataKey="amount"
            fill="hsl(var(--muted-foreground))"
            radius={[4, 4, 0, 0]}
            name="Reconciliation Cost"
            opacity={0.5}
          />

          {/* Document billed bar */}
          {!hideDocumentBars && (
            <Bar
              yAxisId="left"
              dataKey="documentAmount"
              fill="hsl(var(--primary))"
              radius={[4, 4, 0, 0]}
              name="Document Billed"
            />
          )}

          {/* Meter reading line */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="meterReading"
            stroke="hsl(var(--chart-3))"
            strokeWidth={2}
            name="Meter Reading"
            connectNulls={false}
            dot={(props: any) => {
              const { payload, cx, cy } = props;
              if (payload?.isDiscontinuous) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill="hsl(var(--destructive))"
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              }
              return <circle cx={cx} cy={cy} r={3} fill="hsl(var(--chart-3))" />;
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export default MeterAnalysisChart;
