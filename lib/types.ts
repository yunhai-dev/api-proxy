import type { Channel, Key, RequestLog } from "./db/schema";

export type DashboardRange = "today" | "24h" | "7d" | "custom";

export type LogEntry = RequestLog & {
  keyName: string;
  keyPrefix: string;
  channelName: string;
  channelType: "claude" | "openai";
  userName?: string;
  username?: string;
  cost: number;
};

export type LogListEntry = Omit<LogEntry, "requestDetail" | "errorMsg"> & {
  hasDetail: boolean;
};

export type ChannelWithTraffic = Channel & { requestsLast1h: number };

export type KeyWithQuota = Key;

export type DashboardStats = {
  requests24h: number;
  activeConversations: number;
  requestsDelta: number;
  successRate: number;
  successDelta: number;
  p50: number;
  p50Delta: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  cacheHit: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  globalPerf: {
    qps: number;
    tps: number;
    ttftAvgMs: number;
    ttftP50Ms: number;
    ttftP90Ms: number;
    ttftP95Ms: number;
    ttftMaxMs: number;
    durationAvgMs: number;
    durationP50Ms: number;
    durationP90Ms: number;
    durationP95Ms: number;
    durationMaxMs: number;
  };
  throughputSeries: { ts: number; qps: number; tps: number }[];
  trafficByChannel: { id: string; name: string; type: "claude" | "openai"; n: number }[];
  topKeys: {
    id: string;
    name: string;
    prefix: string;
    last: number;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cacheTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    cost: number;
  }[];
  topUsers: {
    id: string;
    name: string;
    username: string;
    last: number;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cacheTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    cost: number;
  }[];
  modelStats: {
    provider: "claude" | "openai";
    model: string;
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cacheTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    cost: number;
  }[];
  userTokenUsers: { id: string; name: string; totalTokens: number }[];
  userTokenSeries: ({ ts: number } & Record<string, number>)[];
};
