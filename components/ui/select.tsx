"use client";

import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find(o => o.value === value);
  const filteredOptions = useMemo(() => editable && value.trim()
    ? options.filter(o => optionText(o).includes(value.trim().toLowerCase()))
    : options, [editable, options, value]);

  useEffect(() => {
    if (!open) return;
    const idx = filteredOptions.findIndex(o => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, value, filteredOptions]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = wrapRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!trigger || !menu) return;

    const gap = 4;
    const margin = 8;
    const below = window.innerHeight - trigger.bottom - gap - margin;
    const above = trigger.top - gap - margin;
    const top = below >= menu.height || below >= above
      ? trigger.bottom + gap
      : Math.max(margin, trigger.top - gap - menu.height);
    const maxLeft = Math.max(margin, window.innerWidth - menu.width - margin);
    const left = Math.min(Math.max(margin, trigger.left), maxLeft);
    setMenuRect({ top, left, minWidth: trigger.width });
  }, [open, filteredOptions]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function openMenu() {
    setMenuRect(null);
    setOpen(true);
  }

  function toggleMenu() {
    setMenuRect(null);
    setOpen(o => !o);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && filteredOptions[highlight]) pick(filteredOptions[highlight].value);
      else openMenu();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
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
        <div className="select-trigger mono editable" onClick={() => { if (!disabled) openMenu(); }}>
          <input
            value={value}
            onChange={e => { if (!disabled) { onChange(e.target.value); openMenu(); } }}
            onFocus={() => { if (!disabled) openMenu(); }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
          />
          <button type="button" onClick={() => { if (!disabled) toggleMenu(); }} aria-label="展开选项" disabled={disabled}>
            <span className="select-chevron" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="select-trigger mono"
          onClick={() => { if (!disabled) toggleMenu(); }}
          onKeyDown={onKeyDown}
          disabled={disabled}
        >
          <span className="select-value">{current?.label ?? placeholder}</span>
          <span className="select-chevron" />
        </button>
      )}
      {open && (
        <div
          ref={menuRef}
          className="select-menu"
          style={{ position: "fixed", top: menuRect?.top ?? 0, left: menuRect?.left ?? 0, right: "auto", minWidth: menuRect?.minWidth, width: "max-content", maxWidth: `calc(100vw - ${(menuRect?.left ?? 0) + 8}px)`, visibility: menuRect ? "visible" : "hidden" }}
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
