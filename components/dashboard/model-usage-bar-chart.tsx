"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ModelUsageRow = {
  provider: "claude" | "openai";
  model: string;
  requests: number;
  totalTokens: number;
  cost: number;
};

const COLORS = {
  claude: "oklch(0.64 0.12 65)",
  openai: "oklch(0.56 0.12 230)",
} as const;

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

function shortModel(model: string) {
  return model.length > 30 ? `${model.slice(0, 27)}...` : model;
}

export function ModelUsageBarChart({ rows }: { rows: ModelUsageRow[] }) {
  const data = rows.slice(0, 8).map(row => ({ ...row, label: shortModel(row.model) }));
  const hasData = data.some(row => row.totalTokens > 0);

  return (
    <div className="model-usage-chart">
      <ResponsiveContainer width="100%" height={Math.max(260, data.length * 40 + 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 12, right: 24, bottom: 8, left: 16 }} barCategoryGap={12}>
          <CartesianGrid stroke="oklch(0.88 0.010 75)" strokeDasharray="3 5" horizontal={false} />
          <XAxis type="number" stroke="oklch(0.46 0.012 75)" tick={{ fontSize: 11 }} tickFormatter={fmtToken} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={180} stroke="oklch(0.46 0.012 75)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "oklch(0.92 0.010 75 / 0.60)" }}
            contentStyle={{ background: "oklch(0.995 0.003 75)", border: "1px solid oklch(0.84 0.012 75)", borderRadius: 4, color: "oklch(0.24 0.012 75)", fontSize: 12 }}
            labelFormatter={(_value, payload) => payload?.[0]?.payload?.model ?? "模型"}
            formatter={(value, _name, item) => {
              const row = item.payload as ModelUsageRow;
              return [`${fmtToken(Number(value))} Token · ${row.requests.toLocaleString()} 请求 · $${row.cost.toFixed(2)}`, row.provider];
            }}
          />
          <Bar dataKey="totalTokens" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map(row => <Cell key={`${row.provider}:${row.model}`} fill={COLORS[row.provider]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {!hasData && <div className="chart-empty mono">当前时间范围暂无模型消耗数据</div>}
    </div>
  );
}
