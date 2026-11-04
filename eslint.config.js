import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".interrupted-node-modules*/**",
      ".wrangler/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { console: "readonly" } },
  },
);
