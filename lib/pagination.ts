export type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export function pageParams(url: URL, defaultPageSize = 20) {
  const hasPagination = url.searchParams.has("page") || url.searchParams.has("pageSize");
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("pageSize")) || defaultPageSize)));
  return { hasPagination, page, pageSize };
}

export function pageRows<T>(rows: T[], page: number, pageSize: number): PageResult<T> {
  const total = rows.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  return {
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    total,
    page: safePage,
    pageSize,
  };
}

type SortValue = string | number | boolean | null | undefined;

function compareValue(a: SortValue, b: SortValue) {
  if (typeof a === "number" || typeof b === "number") return (Number(a) || 0) - (Number(b) || 0);
  if (typeof a === "boolean" || typeof b === "boolean") return Number(Boolean(a)) - Number(Boolean(b));
  return String(a ?? "").localeCompare(String(b ?? ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

export function sortRows<T, A extends Record<string, (row: T) => SortValue>>(url: URL, rows: T[], accessors: A, fallback: keyof A & string, fallbackDir: "asc" | "desc" = "asc") {
  type SortKey = keyof A & string;
  const requested = url.searchParams.get("sort") as SortKey | null;
  const key = requested && requested in accessors ? requested : fallback;
  const dir = url.searchParams.get("sortDir") === "desc" ? "desc" : url.searchParams.get("sortDir") === "asc" ? "asc" : fallbackDir;
  return [...rows].sort((a, b) => {
    const n = compareValue(accessors[key](a), accessors[key](b));
    return dir === "asc" ? n : -n;
  });
}

export function queryText(url: URL, ...names: string[]) {
  for (const name of names) {
    const value = url.searchParams.get(name)?.trim() ?? "";
    if (value) return value;
  }
  return "";
}
