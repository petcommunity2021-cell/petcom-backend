import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Next rewrites its managed block in AGENTS.md on every dev start. In 16.4.5
  // it replaces from the first marker occurrence to EOF, which silently ate
  // §8–§14 of the project memory once. The file is hand-maintained now.
  agentRules: false,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
