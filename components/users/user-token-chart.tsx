"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatShanghaiTime } from "@/lib/time";

type Point = { ts: number; input: number; output: number; cacheRead: number; cacheCreation: number };

function fmtTime(ts: number, showDate: boolean) {
  return formatShanghaiTime(ts, showDate);
}

function fmtToken(value: number) {
  if (value < 1000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function UserTokenChart({ data }: { data: Point[] }) {
  const first = data[0]?.ts ?? 0;
  const last = data[data.length - 1]?.ts ?? 0;
  const showDate = last - first >= 24 * 60 * 60 * 1000;
  return (
    <div className="throughput-chart">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="oklch(0.88 0.010 75)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="ts" tickFormatter={value => fmtTime(Number(value), showDate)} stroke="oklch(0.46 0.012 75)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis stroke="oklch(0.46 0.012 75)" tick={{ fontSize: 11 }} tickFormatter={fmtToken} tickLine={false} axisLine={false} width={54} />
          <Tooltip
            contentStyle={{ background: "oklch(0.995 0.003 75)", border: "1px solid oklch(0.84 0.012 75)", borderRadius: 4, color: "oklch(0.24 0.012 75)", fontSize: 12 }}
            labelFormatter={value => fmtTime(Number(value), true)}
            formatter={(value, name) => [fmtToken(Number(value)), label(name as string)]}
          />
          <Line type="monotone" dataKey="input" stroke="oklch(0.78 0.13 75)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="output" stroke="oklch(0.74 0.16 245)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cacheRead" stroke="oklch(0.70 0.13 150)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cacheCreation" stroke="oklch(0.72 0.13 35)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function label(key: string) {
  if (key === "input") return "输入";
  if (key === "output") return "输出";
  if (key === "cacheRead") return "命中缓存";
  return "创建缓存";
}
