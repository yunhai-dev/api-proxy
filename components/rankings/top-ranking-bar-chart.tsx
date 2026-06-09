"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type RankingTone = "key" | "user" | "claude" | "openai";

type RankingChartRow = {
  id: string;
  label: string;
  value: number;
  requests: number;
  cost: number;
  tone: RankingTone;
};

const COLORS: Record<RankingTone, string> = {
  key: "oklch(0.78 0.13 75)",
  user: "oklch(0.70 0.13 150)",
  claude: "oklch(0.78 0.13 75)",
  openai: "oklch(0.74 0.16 245)",
};

function trimNumber(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function fmtToken(value: number) {
  if (value <= 0) return "0";
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${trimNumber(value / 1_000, value < 10_000 ? 2 : 1)}K`;
  if (value < 1_000_000_000) return `${trimNumber(value / 1_000_000, value < 10_000_000 ? 2 : 1)}M`;
  return `${trimNumber(value / 1_000_000_000, value < 10_000_000_000 ? 2 : 1)}B`;
}

function shortLabel(label: string) {
  return label.length > 18 ? `${label.slice(0, 16)}...` : label;
}

export function TopRankingBarChart({ rows, emptyText }: { rows: RankingChartRow[]; emptyText: string }) {
  const data = rows.slice(0, 10).map(row => ({ ...row, shortLabel: shortLabel(row.label) }));
  const hasData = data.some(row => row.value > 0);

  return (
    <div className="ranking-bar-chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 18, right: 18, bottom: 38, left: 8 }} barCategoryGap={16}>
          <CartesianGrid stroke="oklch(0.30 0.008 75)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="shortLabel" stroke="oklch(0.58 0.015 75)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} angle={-24} textAnchor="end" height={52} />
          <YAxis stroke="oklch(0.58 0.015 75)" tick={{ fontSize: 11 }} tickFormatter={fmtToken} tickLine={false} axisLine={false} width={54} />
          <Tooltip
            cursor={{ fill: "oklch(0.28 0.014 75 / 0.28)" }}
            contentStyle={{ background: "oklch(0.18 0.008 75)", border: "1px solid oklch(0.32 0.012 75)", borderRadius: 4, color: "oklch(0.84 0.02 75)", fontSize: 12 }}
            labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? "排行"}
            formatter={(value, _name, item) => {
              const row = item.payload as RankingChartRow;
              return [`${fmtToken(Number(value))} Token · ${row.requests.toLocaleString()} 请求 · $${row.cost.toFixed(2)}`, "Token 总数"];
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={42}>
            {data.map(row => <Cell key={row.id} fill={COLORS[row.tone]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {!hasData && <div className="throughput-empty mono">{emptyText}</div>}
    </div>
  );
}
