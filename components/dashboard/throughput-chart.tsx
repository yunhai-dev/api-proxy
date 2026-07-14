"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShanghaiTime } from "@/lib/time";

type Point = { ts: number; qps: number; tps: number };

function fmtRate(value: number) {
  if (value <= 0) return "0";
  if (value < 1) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (value < 10) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (value < 100) return value.toFixed(1).replace(/0+$/, "").replace(/\.$/, "");
  return Math.round(value).toLocaleString();
}

function fmtTime(ts: number) {
  return formatShanghaiTime(ts);
}

export function ThroughputChart({ series }: { series: Point[] }) {
  const maxQps = Math.max(0, ...series.map(p => p.qps));
  const maxTps = Math.max(0, ...series.map(p => p.tps));
  const hasTraffic = maxQps > 0 || maxTps > 0;

  return (
    <section className="section throughput-section">
      <div className="section-head-inline">
        <h2>吞吐趋势</h2>
        <div className="throughput-head-meta mono">
          <span><i className="qps" />QPS 峰值 {fmtRate(maxQps)}</span>
          <span><i className="tps" />TPS 峰值 {fmtRate(maxTps)}</span>
        </div>
      </div>
      <div className="throughput-chart">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="qpsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.64 0.12 65)" stopOpacity={0.34} />
                <stop offset="100%" stopColor="oklch(0.64 0.12 65)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="tpsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.56 0.12 230)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="oklch(0.56 0.12 230)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(0.88 0.010 75)" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={fmtTime}
              stroke="oklch(0.46 0.012 75)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="qps"
              stroke="oklch(0.46 0.012 75)"
              tick={{ fontSize: 11 }}
              tickFormatter={fmtRate}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={[0, maxQps > 0 ? maxQps * 1.2 : 1]}
            />
            <YAxis
              yAxisId="tps"
              orientation="right"
              stroke="oklch(0.46 0.012 75)"
              tick={{ fontSize: 11 }}
              tickFormatter={fmtRate}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={[0, maxTps > 0 ? maxTps * 1.2 : 1]}
            />
            <Tooltip
              contentStyle={{
                background: "oklch(0.995 0.003 75)",
                border: "1px solid oklch(0.84 0.012 75)",
                borderRadius: 4,
                color: "oklch(0.24 0.012 75)",
                fontSize: 12,
              }}
              labelFormatter={value => fmtTime(Number(value))}
              formatter={(value, name) => [fmtRate(Number(value)), String(name)]}
            />
            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
            <Area
              yAxisId="qps"
              type="monotone"
              dataKey="qps"
              name="QPS"
              fill="url(#qpsFill)"
              stroke="oklch(0.64 0.12 65)"
              strokeWidth={2.4}
              dot={p => p.value > 0 ? <circle cx={p.cx} cy={p.cy} r={3} fill="oklch(0.64 0.12 65)" /> : <g />}
              activeDot={{ r: 5 }}
            />
            <Area
              yAxisId="tps"
              type="monotone"
              dataKey="tps"
              name="TPS"
              fill="url(#tpsFill)"
              stroke="oklch(0.56 0.12 230)"
              strokeWidth={2.4}
              dot={p => p.value > 0 ? <circle cx={p.cx} cy={p.cy} r={3} fill="oklch(0.56 0.12 230)" /> : <g />}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        {!hasTraffic && <div className="chart-empty mono">当前时间范围暂无吞吐数据</div>}
      </div>
    </section>
  );
}
