"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

type SortDir = "asc" | "desc";
type SortValue = string | number | boolean | null | undefined;

function compareValue(a: SortValue, b: SortValue) {
  if (typeof a === "number" || typeof b === "number") return (Number(a) || 0) - (Number(b) || 0);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(Boolean(a)) - Number(Boolean(b));
  return String(a ?? "").localeCompare(String(b ?? ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function useSortableRows<T, A extends Record<string, (row: T) => SortValue>>(rows: T[], accessors: A, initialKey: keyof A & string, initialDir: SortDir = "asc") {
  type SortKey = keyof A & string;
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: initialKey, dir: initialDir });
  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const n = compareValue(accessors[sort.key](a), accessors[sort.key](b));
    return sort.dir === "asc" ? n : -n;
  }), [rows, accessors, sort]);

  function sortHeader(key: SortKey, label: ReactNode, className = "") {
    const active = sort.key === key;
    const nextDir = active && sort.dir === "asc" ? "desc" : "asc";
    return (
      <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className={`sort-button${active ? " active" : ""}`} onClick={() => setSort({ key, dir: nextDir })}>
          <span>{label}</span>
          <span className="sort-mark">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  }

  function sortButton(key: SortKey, label: ReactNode, className = "") {
    const active = sort.key === key;
    const nextDir = active && sort.dir === "asc" ? "desc" : "asc";
    return (
      <button type="button" className={`sort-button${active ? " active" : ""} ${className}`} onClick={() => setSort({ key, dir: nextDir })}>
        <span>{label}</span>
        <span className="sort-mark">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    );
  }

  return { sortedRows, sortHeader, sortButton, sort };
}
