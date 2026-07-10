"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type ChannelTraffic = { id: string; name: string; type: "claude" | "openai"; n: number };

const COLORS = [
  "oklch(0.64 0.12 65)",
  "oklch(0.56 0.12 230)",
  "oklch(0.56 0.12 150)",
  "oklch(0.58 0.13 35)",
  "oklch(0.60 0.10 310)",
];

export function ChannelTrafficChart({ data }: { data: ChannelTraffic[] }) {
  const total = data.reduce((sum, row) => sum + row.n, 0);
  if (total === 0) return <div className="empty">暂无流量数据 <span className="mono">// waiting</span></div>;

  return (
    <div className="traffic-pie-wrap">
      <div className="traffic-pie">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="n"
              nameKey="name"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="oklch(0.88 0.010 75)"
              strokeWidth={2}
            >
              {data.map((row, i) => <Cell key={row.id} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip
              wrapperStyle={{ zIndex: 50 }}
              contentStyle={{
                background: "oklch(0.995 0.003 75)",
                border: "1px solid oklch(0.84 0.012 75)",
                borderRadius: 4,
                color: "oklch(0.24 0.012 75)",
                fontSize: 12,
              }}
              formatter={(value, _name, item) => {
                const n = Number(value);
                return [`${n.toLocaleString()} 请求 · ${(n / total * 100).toFixed(1)}%`, item.payload.name];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="traffic-pie-total mono">
          <span>{total.toLocaleString()}</span>
          <small>请求</small>
        </div>
      </div>
      <div className="traffic-pie-legend">
        {data.map((row, i) => (
          <div className="traffic-legend-row" key={row.id}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            <span className="name">{row.name}</span>
            <span className={`type-pill ${row.type}`}>{row.type === "claude" ? "Claude" : "OpenAI"}</span>
            <span className="mono pct">{(row.n / total * 100).toFixed(1)}%</span>
            <span className="mono count">{row.n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
