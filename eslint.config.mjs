import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "chat_bot_work/**",
    "next-env.d.ts",
    // Claude Design sync: generated upload bundle (includes a vendored React)
    // and the staged converter scripts. Neither is our source, and both are
    // gitignored — linting them buries real findings under thousands of
    // warnings from third-party code.
    "ds-bundle/**",
    ".ds-sync/**",
  ]),
]);

export default eslintConfig;
