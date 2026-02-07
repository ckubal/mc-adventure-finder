import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/metime";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
