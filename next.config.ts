import type { NextConfig } from "next";

/**
 * Aegis Share is a fully client-side app — every byte of crypto and transfer
 * logic runs in the browser. Static export keeps Cloudflare Pages hosting
 * serverless: the deploy is pure files, no server code, no API routes.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
