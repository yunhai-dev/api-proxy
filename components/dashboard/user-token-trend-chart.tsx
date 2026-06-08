"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type UserLine = { id: string; name: string; totalTokens: number };
type Point = { ts: number } & Record<string, number>;

const COLORS = [
  "oklch(0.78 0.13 75)",
  "oklch(0.74 0.16 245)",
  "oklch(0.70 0.13 150)",
  "oklch(0.72 0.13 35)",
  "oklch(0.68 0.12 310)",
  "oklch(0.76 0.10 15)",
];

function fmtTime(ts: number, showDate: boolean) {
  const d = new Date(ts);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (!showDate) return time;
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${time}`;
}

function fmtToken(value: number) {
  if (value < 1000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function UserTokenTrendChart({ users, data }: { users: UserLine[]; data: Point[] }) {
  const first = data[0]?.ts ?? 0;
  const last = data[data.length - 1]?.ts ?? 0;
  const showDate = last - first >= 24 * 60 * 60 * 1000;
  const names = new Map(users.map(user => [user.id, user.name]));
  const hasData = users.some(user => user.totalTokens > 0);
  const chartData = data.map(point => {
    const next = { ...point };
    for (const user of users) next[user.id] = point[user.id] ?? 0;
    return next;
  });

  return (
    <section className="section user-token-trend-section">
      <div className="section-head-inline">
        <h2>用户 Token 趋势</h2>
        <span className="mono dim">{users.length || 0} users with usage</span>
      </div>
      <div className="throughput-chart">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="oklch(0.30 0.008 75)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={value => fmtTime(Number(value), showDate)} stroke="oklch(0.58 0.015 75)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis stroke="oklch(0.58 0.015 75)" tick={{ fontSize: 11 }} tickFormatter={fmtToken} tickLine={false} axisLine={false} width={54} />
            <Tooltip
              contentStyle={{ background: "oklch(0.18 0.008 75)", border: "1px solid oklch(0.32 0.012 75)", borderRadius: 4, color: "oklch(0.84 0.02 75)", fontSize: 12 }}
              labelFormatter={value => fmtTime(Number(value), true)}
              formatter={(value, name) => [fmtToken(Number(value)), names.get(String(name)) ?? String(name)]}
            />
            {users.map((user, index) => (
              <Line key={user.id} type="monotone" dataKey={user.id} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {!hasData && <div className="throughput-empty mono">当前时间范围暂无用户 Token 数据</div>}
      </div>
      {users.length > 0 && (
        <div className="user-token-legend">
          {users.map((user, index) => (
            <div key={user.id} className="user-token-legend-row">
              <i style={{ background: COLORS[index % COLORS.length] }} />
              <span>{user.name}</span>
              <strong className="mono">{fmtToken(user.totalTokens)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
