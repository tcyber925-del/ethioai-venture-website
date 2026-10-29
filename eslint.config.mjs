import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    // `.tmp/` is the scratch directory the review job is told to use
    // (TMPDIR=$PWD/.tmp), and it is in .gitignore. Flat config does not read
    // .gitignore, so without this a reviewer's own scratch script fails
    // `npm run lint` and therefore `npm run verify`.
    //
    // `.opencode/` is the factory harness, maintained outside the application
    // and refreshed wholesale by `install.sh --update` (ENG-110). Its
    // `skills/factory/tools/*.mjs` are the pack's own Node scripts: they run in
    // Node and use Node globals, so linting them as application code fails on
    // `no-undef` for `process` alone. Ignoring them keeps an upstream pack
    // refresh from turning this repository's gate red, which is the same
    // reason `.opencode/` is already in `.prettierignore`.
    ignores: ["dist/", ".astro/", "node_modules/", ".tmp/", ".opencode/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    // Node globals for the deterministic build-check scripts and their
    // test batteries (ENG-87).
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
]);
