"use client";

import { useState } from "react";
import { startOfShanghaiDay, toShanghaiDateTimeLocal } from "@/lib/time";
import { DateTimePicker } from "./date-time-picker";

function todayRange() {
  const now = Date.now();
  return { from: toShanghaiDateTimeLocal(startOfShanghaiDay(now)), to: toShanghaiDateTimeLocal(now) };
}

function rollingRange(ms: number) {
  const now = Date.now();
  return { from: toShanghaiDateTimeLocal(now - ms), to: toShanghaiDateTimeLocal(now) };
}

export function RangeForm({ from, to, action = "/dashboard" }: { from: string; to: string; action?: string }) {
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  function applyPreset(next: { from: string; to: string }) {
    setFromValue(next.from);
    setToValue(next.to);
  }

  return (
    <form className="range-form" action={action} method="get">
      <input type="hidden" name="range" value="custom" />
      <div className="range-presets">
        <button type="button" className="btn ghost" onClick={() => applyPreset(todayRange())}>今日</button>
        <button type="button" className="btn ghost" onClick={() => applyPreset(rollingRange(24 * 60 * 60 * 1000))}>最近 24h</button>
        <button type="button" className="btn ghost" onClick={() => applyPreset(rollingRange(7 * 24 * 60 * 60 * 1000))}>最近 7 天</button>
      </div>
      <DateTimePicker label="开始" name="from" value={fromValue} onChange={setFromValue} />
      <DateTimePicker label="结束" name="to" value={toValue} onChange={setToValue} />
      <button className="btn primary" type="submit">应用区间</button>
    </form>
  );
}
