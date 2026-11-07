import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// shared/contract.ts lives one level up, so the dev server may read the repo root.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
