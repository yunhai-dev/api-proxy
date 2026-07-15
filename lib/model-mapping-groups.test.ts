// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { groupMappings, normalizeInboundModels, type MappingRow } from "./model-mapping-groups";

const base: Omit<MappingRow, "id" | "groupId" | "inboundModel" | "createdAt"> = {
  provider: "claude",
  targetProvider: "openai",
  upstreamModel: "gpt-5",
  channelIds: [],
  enabled: true,
};

describe("model mapping groups", () => {
  test("keeps legacy rows separate and groups explicit members", () => {
    const rows: MappingRow[] = [
      { ...base, id: "legacy-1", groupId: null, inboundModel: "same", createdAt: 1 },
      { ...base, id: "legacy-2", groupId: null, inboundModel: "same", createdAt: 2 },
      { ...base, id: "group-2", groupId: "group", inboundModel: "alias-b", createdAt: 4 },
      { ...base, id: "group-1", groupId: "group", inboundModel: "alias-a", createdAt: 3 },
    ];

    const groups = groupMappings(rows);
    expect(groups).toHaveLength(3);
    expect(groups[2].memberIds).toEqual(["group-1", "group-2"]);
    expect(groups[2].inboundModels).toEqual(["alias-a", "alias-b"]);
  });

  test("normalizes only the submitted aliases", () => {
    expect(normalizeInboundModels([" alias ", "", "alias", "other"], "ignored"))
      .toEqual(["alias", "other"]);
    expect(normalizeInboundModels(undefined, " single ")).toEqual(["single"]);
  });
});
