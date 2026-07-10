"use client";

import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { useEffect, useRef, useState } from "react";

function splitDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return { date: undefined, time: "00:00" };
  const [, y, m, d, h, min] = match;
  return {
    date: new Date(Number(y), Number(m) - 1, Number(d)),
    time: `${h}:${min}`,
  };
}

function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateLabel(value: string) {
  const [date, time] = value.split("T");
  return date && time ? `${date} ${time}` : "选择时间";
}

export function DateTimePicker({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { date, time } = splitDateTime(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function commit(nextDate = date, nextTime = time) {
    if (!nextDate) return;
    onChange(`${formatDate(nextDate)}T${nextTime}`);
  }

  return (
    <div className="range-field range-picker" ref={wrapRef}>
      <span>{label}</span>
      <input type="hidden" name={name} value={value} />
      <button className="range-picker-trigger mono" type="button" onClick={() => setOpen(v => !v)}>
        {dateLabel(value)}
      </button>
      {open && (
        <div className="range-picker-popover">
          <DayPicker mode="single" selected={date} onSelect={next => { if (next) commit(next, time); }} />
          <div className="range-picker-time">
            <span>时间</span>
            <input className="ui-input mono" type="time" value={time} onChange={event => commit(date, event.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
