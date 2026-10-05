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
import { join, relative, sep } from "node:path";
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

/** One recursive walker, filtered by extension — both asset kinds need it. */
function walkFor(dir, extension, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFor(full, extension, out);
    else if (entry.name.toLowerCase().endsWith(extension)) out.push(full);
  }
  return out;
}

const cssFiles = walkFor(distDir, ".css");
const htmlFiles = walkFor(distDir, ".html");
if (cssFiles.length === 0 && htmlFiles.length === 0) {
  console.error("check:work failed — no CSS or HTML output in dist/.");
  process.exit(1);
}

/**
 * Slugs declared by the project collection. Derived rather than hardcoded so
 * adding or renaming a project cannot make this check silently stale — the same
 * discipline ENG-97 filed for `slug` validation applies to the gate that reads
 * it.
 *
 * Walks RECURSIVELY, matching the collection loader's recursive markdown glob in
 * `src/content.config.ts`: a top-level-only read would skip a nested entry and
 * silently under-check it, which is the exact staleness this avoids.
 *
 * `slug` is read from the frontmatter block only, so a trailing comment or a
 * `slug:` word in the body cannot be picked up as the identifier.
 */
function projectSlugs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const slugs = [];
  const entries = [];
  const collect = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.mdx?$/i.test(entry.name)) entries.push(full);
    }
  };
  collect(dir);

  for (const file of entries.sort()) {
    const text = readFileSync(file, "utf8");
    // Frontmatter is the leading `---` fenced block; without one there is no
    // declared slug and the entry is skipped rather than guessed from the body.
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (frontmatter === null) continue;
    const match = /^slug:\s*(.+?)\s*$/m.exec(frontmatter[1]);
    if (match === null) continue;
    const slug = (match[1] ?? "")
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (slug.length > 0) slugs.push(slug);
  }
  return slugs.sort();
}

/**
 * Resolves a route to the file Astro actually wrote. Astro emits `directory`
 * (`work/<slug>/index.html`) by default and `file` (`work/<slug>.html`) under
 * `build.format: "file"`; the sibling gates accept either, so this gate must too
 * rather than reporting a false "missing page" after a format change.
 */
function resolvesToFile(route) {
  return [join(route, "index.html"), `${route}.html`].some((candidate) =>
    existsSync(join(distDir, candidate)),
  );
}

const requiredRoutes = ["/work"];
for (const slug of projectSlugs(projectsDir)) {
  requiredRoutes.push(`/work/${slug}`);
}

const failures = [];
const foundRules = [];

/**
 * CSS actually shipped to the browser.
 *
 * Scoped component CSS ships inlined in a `<style>` block; the emitted
 * stylesheet carries design tokens. Both are read, so the gate cannot be
 * satisfied or defeated by which of the two a rule lands in.
 *
 * Only the CONTENTS of a real `<style>` element are taken, and CSS comments are
 * stripped. Scanning raw page text instead would let a selector named in prose,
 * in an HTML comment, or in an attribute value satisfy the gate with the rule
 * deleted from the stylesheet — the exact failure this gate exists to catch.
 * Sibling gates (check-dist, check-seo) defend against this same class of
 * false-green for the same reason.
 */
function shippedCss(html) {
  const blocks = [];
  const styleBlocks = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleBlocks.exec(html)) !== null) blocks.push(match[1] ?? "");
  return blocks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Each CSS source, with an origin so a verdict can name what carried a rule. */
const cssSources = [
  ...cssFiles.map((file) => ({
    origin: relative(distDir, file).split(sep).join("/"),
    text: readFileSync(file, "utf8"),
  })),
  ...htmlFiles.map((file) => ({
    origin: `${relative(distDir, file).split(sep).join("/")} <style>`,
    text: shippedCss(readFileSync(file, "utf8")),
  })),
];

for (const rule of REQUIRED_RULES) {
  // `(?:\[[^\]]*\])*` absorbs Astro's injected scoping attributes between the
  // class and `[hidden]`.
  const rulePattern = new RegExp(
    `${escapeRegExp(rule.className)}(?:\\[[^\\]]*\\])*\\s*${escapeRegExp(rule.attribute)}\\s*\\{[^}]*?${rule.declarationPattern}`,
    "i",
  );
  const carriers = cssSources.filter((source) => rulePattern.test(source.text));
  if (carriers.length === 0) {
    failures.push(
      `built output is missing ${rule.label}: ${rule.className}${rule.attribute} { display: none } (declared in ${rule.source})`,
    );
    continue;
  }
  foundRules.push({
    label: rule.label,
    carriers: carriers.map((source) => source.origin),
  });
}

for (const route of requiredRoutes) {
  if (!resolvesToFile(route.slice(1))) {
    failures.push(`missing built page: ${route}`);
  }
}

if (failures.length > 0) {
  console.error(`check:work failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

// Attribute each rule to the artifact that carried it, so a passing verdict says
// where the rule was found rather than just that it was found.
const carriers = foundRules
  .map(
    (rule) =>
      `${rule.label} → ${[...new Set(rule.carriers)].slice(0, 3).join(", ")}`,
  )
  .join("; ");
console.log(
  `check:work passed — ${foundRules.length} hide rule(s) in ${cssSources.length} CSS source(s), ${requiredRoutes.length} route(s) present. ${carriers}`,
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
