import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The dev badge covers the tab bar on the projector.
  devIndicators: false,
  // A stray lockfile in the home folder makes Next guess the wrong root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
