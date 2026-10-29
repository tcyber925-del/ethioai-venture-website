// pack/tools/lib/pack-paths.mjs
//
// Where the pack's own files live, relative to this tool.
//
// The pack is installed as `<target>/.opencode/skills/factory/`, with
// `reference/`, `schemas/`, `templates/` and `tools/` beside each other, so a
// path resolved from this file's own location is the same path in the
// repository and in an installed target. Nothing here guesses a working
// directory or reads the environment.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `<pack>/tools/lib` */
export const LIB_DIR = dirname(fileURLToPath(import.meta.url));

/** `<pack>/tools` */
export const TOOLS_DIR = resolve(LIB_DIR, "..");

/** `<pack>` -- the directory that holds `reference/` and `schemas/`. */
export const PACK_ROOT = resolve(TOOLS_DIR, "..");

/** A file in the pack's `reference/` directory. */
export const referencePath = (name) => resolve(PACK_ROOT, "reference", name);

/** A file in the pack's `schemas/` directory. */
export const schemaPath = (name) => resolve(PACK_ROOT, "schemas", name);
