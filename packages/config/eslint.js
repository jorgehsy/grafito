import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const sourceImportPatterns = [
  {
    group: ["**/packages/*/src", "**/packages/*/src/**", "**/apps/*/src", "**/apps/*/src/**"],
    message: "Do not import another package's source by path; import it by its package name.",
  },
  {
    group: ["../../packages/**", "../../apps/**", "../../../packages/**", "../../../apps/**"],
    message: "Do not reach into another package or app with a relative path; import it by its package name.",
  },
];

/**
 * Shared ESLint flat config.
 * `react: true` adds the react-hooks rules (apps/web).
 * `layer` picks the package-boundary rules: "web" (apps/web), "package" (packages/*), "server" (apps/server).
 */
export function config({ react = false, layer = "package" } = {}) {
  const patterns = [...sourceImportPatterns];
  if (layer === "web") {
    patterns.push({ group: ["@grafito/server", "@grafito/server/**"], message: "apps/web must not import @grafito/server." });
  }
  if (layer === "package") {
    patterns.push({
      group: ["@grafito/web", "@grafito/web/**", "@grafito/server", "@grafito/server/**"],
      message: "packages/* must not import from apps/*.",
    });
  }

  return tseslint.config(
    { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: { ...globals.node, ...(react ? globals.browser : {}) } },
      rules: {
        "no-restricted-imports": ["error", { patterns }],
        // Warn, not error: the existing code uses `any` in many places (tests, speech, SSE); tighten later.
        "@typescript-eslint/no-explicit-any": "warn",
        // `_`-prefixed names mark intentionally unused parameters.
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        // Existing code uses `cond ? a() : b()` and `x && f()` as statements.
        "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
      },
    },
    // Only the two classic hooks rules; the React Compiler rules in the v7 preset flag existing patterns.
    react
      ? {
          plugins: { "react-hooks": reactHooks },
          rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
        }
      : [],
  );
}
