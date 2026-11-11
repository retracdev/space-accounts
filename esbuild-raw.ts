import type { Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Lets the worker bundle use Vite-style `?raw` imports (e.g. blacklist-google.yml).
export const rawText: Plugin = {
  name: "raw-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(dirname(args.importer), args.path.slice(0, -4)),
      namespace: "raw-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};
