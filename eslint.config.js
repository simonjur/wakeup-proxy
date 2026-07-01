import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "package-lock.json"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // req/res/err/config/etc. are idiomatic here — don't force long names.
      "unicorn/prevent-abbreviations": "off",
      "unicorn/name-replacements": "off",
      // Names like `wantsHtml` / `isImmichUp` read fine; don't force a prefix scheme.
      "unicorn/consistent-boolean-name": "off",
      // Module-level mutable singletons (health cache, wake state) are intentional.
      "unicorn/no-top-level-assignment-in-function": "off",
      // We intentionally use `null` (health cache sentinel, JSON.parse results).
      "unicorn/no-null": "off",
      // Plain process.exit in the shutdown handler is fine for this CLI.
      "unicorn/no-process-exit": "off",
    },
  },

  // Prettier last: turn off all formatting-related lint rules.
  prettier,
);
