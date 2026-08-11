import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { localDevOrigins } from "./lib/development";

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins,
  output: "standalone",
  reactStrictMode: true,
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
};

export default nextConfig;
