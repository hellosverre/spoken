import path from "node:path";
import type { NextConfig } from "next";

// SPOKEN_EXPORT=1: static export (out/) for the Bun call server, which serves it at / on the
// same origin as its REST and live WebSocket. The app is fully client-side, so no SSR is needed.
// PPR can't run in export mode, so it stays on only for `next dev` and normal builds.
const exportBuild = process.env.SPOKEN_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(exportBuild ? { output: "export" as const } : { cacheComponents: true, partialPrefetching: true }),
  // The dev badge covers the tab bar on the projector.
  devIndicators: false,
  // A stray lockfile in the home folder makes Next guess the wrong root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
