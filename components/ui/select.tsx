"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
};

export function Select({
  value, onChange, options,
  placeholder = "选择…",
  className = "",
  size = "md",
  editable = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  editable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; minWidth: number; maxWidth: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = options.find(o => o.value === value);
  const filteredOptions = useMemo(() => editable && value.trim()
    ? options.filter(o => optionText(o).includes(value.trim().toLowerCase()))
    : options, [editable, options, value]);

  useEffect(() => {
    if (!open) return;
    const idx = filteredOptions.findIndex(o => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setMenuRect({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width, maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 16) });
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, value, filteredOptions]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && filteredOptions[highlight]) pick(filteredOptions[highlight].value);
      else setOpen(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight(h => filteredOptions.length ? Math.min(filteredOptions.length - 1, h + 1) : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`select ${open ? "open" : ""} ${size === "sm" ? "sm" : ""} ${disabled ? "disabled" : ""} ${className}`}
    >
      {editable ? (
        <div className="select-trigger mono editable" onClick={() => { if (!disabled) setOpen(true); }}>
          <input
            value={value}
            onChange={e => { if (!disabled) { onChange(e.target.value); setOpen(true); } }}
            onFocus={() => { if (!disabled) setOpen(true); }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
          />
          <button type="button" onClick={() => { if (!disabled) setOpen(o => !o); }} aria-label="展开选项" disabled={disabled}>
            <span className="select-chevron" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="select-trigger mono"
          onClick={() => { if (!disabled) setOpen(o => !o); }}
          onKeyDown={onKeyDown}
          disabled={disabled}
        >
          <span className="select-value">{current?.label ?? placeholder}</span>
          <span className="select-chevron" />
        </button>
      )}
      {open && (
        <div
          className="select-menu"
          style={menuRect ? { position: "fixed", top: menuRect.top, left: menuRect.left, right: "auto", minWidth: menuRect.minWidth, maxWidth: menuRect.maxWidth } : undefined}
        >
          {filteredOptions.length === 0 && <div className="select-empty mono">无匹配选项</div>}
          {filteredOptions.map((o, i) => (
            <div
              key={o.value}
              className={`select-item mono ${i === highlight ? "active" : ""} ${o.value === value ? "current" : ""} ${o.disabled ? "disabled" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => { e.preventDefault(); if (!o.disabled) pick(o.value); }}
            >
              <span className="select-check">{o.value === value ? "✓" : ""}</span>
              <span>{o.label}</span>
              {o.hint && <span className="dim">{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function optionText(option: SelectOption) {
  const label = typeof option.label === "string" ? option.label : "";
  return `${option.value} ${label} ${option.hint ?? ""}`.toLowerCase();
}
