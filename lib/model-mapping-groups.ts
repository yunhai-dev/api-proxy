export type MappingRow = {
  id: string;
  groupId: string | null;
  provider: "claude" | "openai";
  targetProvider: "claude" | "openai";
  inboundModel: string;
  upstreamModel: string;
  channelIds: string[];
  enabled: boolean;
  createdAt: number;
};

export type MappingGroup = Omit<MappingRow, "inboundModel"> & {
  memberIds: string[];
  inboundModels: string[];
};

export function normalizeInboundModels(input: unknown, fallback?: unknown) {
  const values = Array.isArray(input) ? input : [fallback];
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean))];
}

export function groupMappings(rows: MappingRow[]): MappingGroup[] {
  const groups = new Map<string, MappingRow[]>();
  for (const row of rows) {
    const key = row.groupId ? `group:${row.groupId}` : `row:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(members => {
    const ordered = [...members].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const first = ordered[0];
    return {
      ...first,
      memberIds: ordered.map(row => row.id),
      inboundModels: ordered.map(row => row.inboundModel),
    };
  });
}
