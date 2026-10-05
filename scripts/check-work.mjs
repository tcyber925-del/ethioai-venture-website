#!/usr/bin/env node
/**
 * ENG-95 — deterministic regression checks for the /work surface.
 *
 * The /work status filter's correctness hinges on two compiled CSS rules —
 * `.project-card[hidden]{display:none}` (src/components/work/ProjectCard.astro)
 * and `.filter[hidden]{display:none}` (src/components/work/StatusFilter.astro).
 * Author display rules beat the UA `[hidden]` rule, so if either rule is dropped
 * the filter stops hiding cards — and the failure is purely visual. That is how
 * the round-1 HIGH bug in ENG-80 (filter never hiding cards) shipped through a
 * green verify run: no existing check inspects the built stylesheets.
 *
 * This check reads the BUILT output, not the sources, because the defect being
 * guarded is a rule surviving the build. A rule present in source but tree-shaken
 * or reordered out of the emitted CSS is exactly the case that must fail.
 *
 * Boundary: automated regression protection only. Visual/interaction QA of the
 * filter itself stays in ENG-86 — a passing check here cannot observe whether the
 * filter behaves correctly, only whether the rules it depends on still ship.
 *
 * `<h1>` uniqueness is NOT re-checked: ENG-87's `check:dist` already asserts
 * exactly one `<h1>` per rendered page. Re-asserting it would create a second
 * implementation of an existing gate, and two copies drift.
 *
 * Local reproduction: npm run build && npm run check:work
 * Regression battery: npm test (tests/check-work.test.mjs via node:test —
 * wired into `npm run verify` and the CI job with the check-dist suite).
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Default to the repo's dist/ and content collection; explicit paths (tests,
// ad-hoc runs against another build) are taken as-is.
const distDir = process.argv[2] ? process.argv[2] : join(repoRoot, "dist");
const projectsDir = process.argv[3]
  ? process.argv[3]
  : join(repoRoot, "src/content/projects");

/**
 * Rules that must survive the build. Matched structurally rather than as literal
 * substrings, because two things stand between the source and the shipped CSS:
 *
 *  1. Astro scopes component styles by inserting its own attribute selector,
 *     so `.project-card[hidden]` ships as
 *     `.project-card[data-astro-cid-cgl2u52c][hidden]`. Any number of
 *     intervening attribute selectors are therefore allowed.
 *  2. Astro inlines scoped component CSS into a `<style>` block in the page,
 *     NOT into the emitted stylesheet — `dist/_astro/*.css` carries only the
 *     design tokens. A check that read stylesheets alone would be blind to the
 *     very rules it guards, so both sources are scanned.
 *
 * The class, the `[hidden]` attribute and the declaration must all appear inside
 * one rule block: a rule keeping `.project-card` but dropping its `display` is
 * the other half of the original bug.
 */
const REQUIRED_RULES = [
  {
    label: "project card hide rule",
    className: ".project-card",
    attribute: "[hidden]",
    declarationPattern: "display\\s*:\\s*none",
    source: "src/components/work/ProjectCard.astro",
  },
  {
    label: "status filter hide rule",
    className: ".filter",
    attribute: "[hidden]",
    declarationPattern: "display\\s*:\\s*none",
    source: "src/components/work/StatusFilter.astro",
  },
];

if (!existsSync(distDir)) {
  console.error(
    "check:work failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

function stylesheets(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(full, out);
    else if (entry.name.toLowerCase().endsWith(".css")) out.push(full);
  }
  return out;
}

const cssFiles = stylesheets(distDir);
const htmlFiles = pages(distDir);
if (cssFiles.length === 0 && htmlFiles.length === 0) {
  console.error("check:work failed — no CSS or HTML output in dist/.");
  process.exit(1);
}

/** Every emitted HTML page — inline <style> blocks carry scoped component CSS. */
function pages(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) pages(full, out);
    else if (entry.name.toLowerCase().endsWith(".html")) out.push(full);
  }
  return out;
}

/**
 * Slugs declared by the project collection. Derived rather than hardcoded so
 * adding or renaming a project cannot make this check silently stale — the same
 * discipline ENG-97 filed for `slug` validation applies to the gate that reads
 * it. A missing collection directory yields no detail pages to expect (e.g. when
 * pointed at an unrelated build); the index page is still required.
 */
function projectSlugs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const slugs = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
    const text = readFileSync(join(dir, entry.name), "utf8");
    const match = /^slug:\s*(.+?)\s*$/m.exec(text);
    if (match !== null) slugs.push(match[1].trim().replace(/^["']|["']$/g, ""));
  }
  return slugs.sort();
}

const expectedPages = ["work/index.html"];
for (const slug of projectSlugs(projectsDir)) {
  expectedPages.push(`work/${slug}/index.html`);
}

const failures = [];

// Scoped component CSS ships inlined in a <style> block; the emitted
// stylesheet carries design tokens. Both are read so the gate cannot be
// satisfied (or defeated) by which of the two a rule happens to land in.
const inlineStyleText = htmlFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => block);
const cssText =
  cssFiles.map((file) => readFileSync(file, "utf8")).join("\n") +
  "\n" +
  inlineStyleText;

for (const rule of REQUIRED_RULES) {
  // `(?:\[[^\]]*\])*` absorbs Astro's injected scoping attributes between the
  // class and `[hidden]`.
  const rulePattern = new RegExp(
    `${escapeRegExp(rule.className)}(?:\\[[^\\]]*\\])*\\s*${escapeRegExp(rule.attribute)}\\s*\\{[^}]*?${rule.declarationPattern}`,
    "i",
  );
  if (!rulePattern.test(cssText)) {
    failures.push(
      `built output is missing ${rule.label}: ${rule.className}${rule.attribute} { display: none } (declared in ${rule.source})`,
    );
  }
}

for (const page of expectedPages) {
  if (!existsSync(join(distDir, page))) {
    failures.push(
      `missing built page: /${page.replace(/(^|\/)index\.html$/i, "$1")}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`check:work failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:work passed — ${REQUIRED_RULES.length} hide rule(s) present in ${cssFiles.length} stylesheet(s) + ${htmlFiles.length} page(s), ${expectedPages.length} page(s) expected.`,
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
