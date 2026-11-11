import { defineConfig } from "vite";
import { build } from "esbuild";
import { resolve } from "node:path";
import { rawText } from "./esbuild-raw";

export default defineConfig({
  build: { target: "es2022", emptyOutDir: true },
  plugins: [
    {
      name: "accounts-worker",
      apply: "build",
      // Run after Vite writes the frontend and empties the output directory.
      // Keeping this in Vite also covers Cloudflare builds invoking vite directly.
      async writeBundle(output) {
        await build({
          entryPoints: [resolve(import.meta.dirname, "src/server/worker.ts")],
          outfile: resolve(output.dir ?? "dist", "_worker.js"),
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2022",
          conditions: ["workerd", "worker", "browser"],
          external: ["node:*", "cloudflare:*"],
          plugins: [rawText],
        });
      },
    },
  ],
});
