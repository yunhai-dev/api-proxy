export type Sub2ApiConfig = { baseUrl: string; adminKey: string };
export type Sub2ApiGroup = { id: number; name: string; platform: string };
export type Sub2ApiAccount = {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean;
  concurrency: number;
  currentConcurrency: number;
  priority: number;
  rateMultiplier: number;
  groups: Sub2ApiGroup[];
  rateLimited: boolean;
  rateLimitedAt: number | string | null;
  rateLimitResetAt: number | string | null;
  overloadUntil: number | string | null;
  tempUnschedulableReason: string;
  tempUnschedulableUntil: number | string | null;
  expiresAt: number | string | null;
  lastUsedAt: number | string | null;
  updatedAt: number | string | null;
};
export type Sub2ApiAccountDetail = Sub2ApiAccount & {
  errorMessage: string;
  quotaDimension: string;
  sessionWindowStatus: string;
  sessionWindowStart: number | string | null;
  sessionWindowEnd: number | string | null;
};

type RecordValue = Record<string, unknown>;
export type Sub2ApiPage<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number };

export class Sub2ApiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export function normalizeSub2ApiBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Sub2ApiError("Sub2API Base URL 无效", 400); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Sub2ApiError("Sub2API Base URL 无效", 400);
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return url.toString().replace(/\/$/, "");
}

export function parseSub2ApiPage(page: string | null, pageSize: string | null) {
  const parsedPage = Number(page ?? "1");
  const parsedSize = Number(pageSize ?? "20");
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || ![10, 20, 50, 100].includes(parsedSize)) {
    throw new Sub2ApiError("分页参数无效", 400);
  }
  return { page: parsedPage, pageSize: parsedSize };
}

export async function listSub2ApiAccounts(
  config: Sub2ApiConfig,
  input: { page: number; pageSize: number; platform?: string; status?: string; search?: string },
): Promise<Sub2ApiPage<Sub2ApiAccount>> {
  const query = new URLSearchParams({ page: String(input.page), page_size: String(input.pageSize) });
  if (input.platform) query.set("platform", input.platform);
  if (input.status) query.set("status", input.status);
  if (input.search) query.set("search", input.search);
  const data = await request(config, `/admin/accounts?${query}`);
  const page = parsePage(data);
  return { ...page, items: page.items.map(safeAccount) };
}

export async function getSub2ApiAccount(config: Sub2ApiConfig, id: number): Promise<Sub2ApiAccountDetail> {
  return safeAccountDetail(await request(config, `/admin/accounts/${id}`));
}

export type Sub2ApiStatus = Awaited<ReturnType<typeof getSub2ApiStatus>>;

export async function getSub2ApiStatus(config: Sub2ApiConfig) {
  const first = await listSub2ApiAccounts(config, { page: 1, pageSize: 100 });
  const accounts = [...first.items];
  for (let page = 2; page <= first.pages; page += 1) {
    accounts.push(...(await listSub2ApiAccounts(config, { page, pageSize: 100 })).items);
  }
  const [capacityRaw, groupsRaw, snapshotRaw] = await Promise.all([
    request(config, "/admin/groups/capacity-summary"),
    request(config, "/admin/groups/all"),
    request(config, "/admin/dashboard/snapshot-v2"),
  ]);
  const groupNames = new Map(asArray(groupsRaw).map(group => [number(group.id), text(group.name)]));
  const groups = asArray(capacityRaw).map(row => ({
    groupId: number(row.group_id),
    name: groupNames.get(number(row.group_id)) || `#${number(row.group_id)}`,
    concurrencyUsed: number(row.concurrency_used),
    concurrencyMax: number(row.concurrency_max),
    sessionsUsed: number(row.sessions_used),
    sessionsMax: number(row.sessions_max),
    rpmUsed: number(row.rpm_used),
    rpmMax: number(row.rpm_max),
  }));
  const now = Date.now();
  const expired = accounts.filter(account => isPast(account.expiresAt, now)).length;
  const rateLimited = accounts.filter(account => isFuture(account.rateLimitResetAt, now) || isFuture(account.overloadUntil, now)).length;
  const platforms = [...accounts.reduce((map, account) => {
    const row = map.get(account.platform) ?? { platform: account.platform || "unknown", total: 0, schedulable: 0, error: 0, currentConcurrency: 0, maxConcurrency: 0 };
    row.total += 1;
    row.schedulable += account.schedulable ? 1 : 0;
    row.error += account.status === "active" && account.schedulable ? 0 : 1;
    row.currentConcurrency += account.currentConcurrency;
    row.maxConcurrency += account.concurrency;
    map.set(account.platform, row);
    return map;
  }, new Map<string, { platform: string; total: number; schedulable: number; error: number; currentConcurrency: number; maxConcurrency: number }>()).values()];
  const snapshot = object(snapshotRaw);
  const stats = object(snapshot.stats);
  return {
    health: {
      total: accounts.length,
      schedulable: accounts.filter(account => account.schedulable).length,
      unschedulable: accounts.filter(account => !account.schedulable).length,
      normal: accounts.filter(account => account.status === "active").length,
      error: accounts.filter(account => account.status !== "active").length,
      rateLimited,
      expired,
      currentConcurrency: accounts.reduce((sum, account) => sum + account.currentConcurrency, 0),
      maxConcurrency: accounts.reduce((sum, account) => sum + account.concurrency, 0),
    },
    groups,
    platforms,
    today: {
      requests: number(stats.today_requests),
      inputTokens: number(stats.today_input_tokens),
      outputTokens: number(stats.today_output_tokens),
      cacheTokens: number(stats.today_cache_read_tokens) + number(stats.today_cache_creation_tokens),
      totalTokens: number(stats.today_tokens),
      cost: number(stats.today_cost),
      actualCost: number(stats.today_actual_cost),
      rpm: number(stats.rpm),
      tpm: number(stats.tpm),
    },
    updatedAt: Date.now(),
  };
}

async function request(config: Sub2ApiConfig, path: string) {
  if (!config.baseUrl || !config.adminKey) throw new Sub2ApiError("请先配置 Sub2API 连接", 400);
  const baseUrl = normalizeSub2ApiBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      headers: { accept: "application/json", "x-api-key": config.adminKey },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !isObject(body) || body.code !== 0) throw new Sub2ApiError("Sub2API 请求失败");
    return body.data;
  } catch (error) {
    if (error instanceof Sub2ApiError) throw error;
    throw new Sub2ApiError(error instanceof DOMException && error.name === "AbortError" ? "Sub2API 请求超时" : "无法连接 Sub2API");
  } finally {
    clearTimeout(timer);
  }
}

function parsePage(value: unknown) {
  const data = object(value);
  const items = asArray(data.items);
  const total = number(data.total);
  const page = number(data.page);
  const pageSize = number(data.page_size);
  const pages = number(data.pages);
  if (page < 1 || pageSize < 1 || total < 0 || pages < 0) throw new Sub2ApiError("Sub2API 返回格式无效");
  return { items, total, page, pageSize, pages };
}

export function safeAccount(value: unknown): Sub2ApiAccount {
  const row = object(value);
  return {
    id: number(row.id), name: text(row.name), platform: text(row.platform), type: text(row.type), status: text(row.status),
    schedulable: row.schedulable === true, concurrency: number(row.concurrency), currentConcurrency: number(row.current_concurrency),
    priority: number(row.priority), rateMultiplier: number(row.rate_multiplier),
    groups: asArray(row.groups).map(group => ({ id: number(group.id), name: text(group.name), platform: text(group.platform) })),
    rateLimited: isFuture(scalar(row.rate_limit_reset_at), Date.now()) || isFuture(scalar(row.overload_until), Date.now()),
    rateLimitedAt: scalar(row.rate_limited_at), rateLimitResetAt: scalar(row.rate_limit_reset_at), overloadUntil: scalar(row.overload_until),
    tempUnschedulableReason: text(row.temp_unschedulable_reason), tempUnschedulableUntil: scalar(row.temp_unschedulable_until),
    expiresAt: scalar(row.expires_at), lastUsedAt: scalar(row.last_used_at), updatedAt: scalar(row.updated_at),
  };
}

function safeAccountDetail(value: unknown): Sub2ApiAccountDetail {
  const row = object(value);
  return {
    ...safeAccount(row),
    errorMessage: text(row.error_message), quotaDimension: text(row.quota_dimension), sessionWindowStatus: text(row.session_window_status),
    sessionWindowStart: scalar(row.session_window_start), sessionWindowEnd: scalar(row.session_window_end),
  };
}

function isObject(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function object(value: unknown): RecordValue { if (!isObject(value)) throw new Sub2ApiError("Sub2API 返回格式无效"); return value; }
function asArray(value: unknown): RecordValue[] { if (!Array.isArray(value) || value.some(item => !isObject(item))) throw new Sub2ApiError("Sub2API 返回格式无效"); return value; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function scalar(value: unknown): number | string | null { return typeof value === "number" || typeof value === "string" ? value : null; }
function millis(value: number | string | null) { if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value; const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; }
function isPast(value: number | string | null, now: number) { const time = millis(value); return time > 0 && time < now; }
function isFuture(value: number | string | null, now: number) { return millis(value) > now; }
