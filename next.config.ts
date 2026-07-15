import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      allowedOrigins: ["ai.yhnotes.com", "dxxs3.com"],
    },
  },
};

export default config;
