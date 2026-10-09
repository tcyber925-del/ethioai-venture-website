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
    ignores: ["dist/", ".astro/", "node_modules/", ".tmp/"],
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
