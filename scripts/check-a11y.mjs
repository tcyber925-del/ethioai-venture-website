#!/usr/bin/env node
/**
 * ENG-103 — deterministic regression checks for the Batch 2 accessibility
 * and navigation fixes.
 *
 * Why this is a build-output gate, not a unit test: every invariant here only
 * exists in the COMPILED markup. `role="list"`, `aria-current="page"`, the
 * chip's default border and the nav-link padding are all decisions that a
 * component can declare in source while the built page ships without them
 * (Astro scoping, a ternary that swallowed a branch, a style that tree-shook
 * away). The failures worth catching live in dist/.
 *
 * Runs after Build, like check:dist / check:seo / check:work / check:fonts /
 * check:pending, because `npm test` runs BEFORE `npm run build` in both
 * `npm run verify` and CI.
 *
 * Boundary: automated regression protection only. Whether the filter behaves
 * correctly, and whether a screen reader announces as expected, stays in
 * ENG-86 (integrated QA) — a passing check here cannot observe either, only
 * that the markup it depends on still ships.
 *
 * What it asserts, per built page:
 *   1. the Work filter chip's DEFAULT boundary uses an approved token that
 *      clears 3:1 (--color-secondary), not the low-contrast --color-border;
 *   2. the primary and footer nav lists expose list semantics (role="list");
 *   3. a nav link on the page's own route carries aria-current="page", and a
 *      page whose route is NOT in the nav (the 404) marks nothing current;
 *   4. nav links carry a NON-ZERO block padding that lifts them to the 24x24
 *      target minimum (`padding-block: 0`, `0 0`, `0 !important` do not count),
 *      read from the CSS THAT PAGE actually sees, not the union of all pages;
 *   5. every marker-stripped list — `<ul>` OR `<ol>` whose class is styled
 *      `list-style: none` — still exposes role="list", so the ENG-103 fix is
 *      protected beyond the two navs and on every list, not just the first.
 *
 * Local reproduction: npm run build && npm run check:a11y
 * Regression battery: tests/check-a11y.test.mjs (fixture dist/ trees).
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// The current-link rule lives in the app module, not a copy here — importing it
// keeps one definition (node --test / the gate run it through Node's TS strip).
import { isCurrentNavHref } from "../src/config/route-patterns.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = process.argv[2] ? process.argv[2] : join(repoRoot, "dist");

const failures = [];
const fail = (message) => failures.push(message);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(
    "check:a11y failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const distFiles = walk(distDir);
const htmlFiles = distFiles.filter((f) => f.toLowerCase().endsWith(".html"));
if (htmlFiles.length === 0) {
  console.error("check:a11y failed — no HTML files in dist/.");
  process.exit(1);
}

const read = (file) => readFileSync(file, "utf8");

/** Strip CSS comments so a selector/value inside one is never matched. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every rule as { selector, body }. The `[^{}]*` groups cannot cross a brace,
 * so a rule nested in `@media … { … }` is still returned with its own selector
 * (the outer at-rule block has a brace in its "body" and so never matches) —
 * media-only rules are therefore NOT invisible to the checks below.
 */
function rules(cssText) {
  const out = [];
  for (const m of stripComments(cssText).matchAll(/([^{}]*?)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/** Scoped component CSS ships inlined in a page `<style>` block. */
function inlineCss(html) {
  const blocks = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1] ?? "");
  return blocks.join("\n");
}

/** The CSS files a page links via `<link rel="stylesheet">`, concatenated. */
function linkedCss(html) {
  const texts = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel="stylesheet"/i.test(tag)) continue;
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (!href) continue;
    const file = join(distDir, href.replace(/^\//, "").split(/[?#]/)[0]);
    if (existsSync(file)) texts.push(read(file));
  }
  return texts.join("\n");
}

/**
 * CSS a single page can actually see: the stylesheets it links plus its inline
 * `<style>`. Scoping the nav checks to this (not the union of every page's CSS)
 * means a page that lost the rule still fails its own check.
 */
const pageCss = (html) => `${linkedCss(html)}\n${inlineCss(html)}`;

/**
 * The Work filter chip's default border. A component-level rule (it ships once
 * wherever the chip is used), so it is checked once over all shipped CSS rather
 * than per page. Astro scopes the selector with its own attribute
 * (`[data-astro-cid-…]`), so the boundary is matched structurally: the
 * `.filter__chip` rule whose block sets `border: 1px solid var(<token>)`. The
 * `[aria-pressed=true]` and `:hover` rules are later blocks and are not matched
 * here — this reads the DEFAULT.
 */
const allCss = [
  ...distFiles
    .filter((f) => f.toLowerCase().endsWith(".css"))
    .map((f) => read(f)),
  ...htmlFiles.map((f) => inlineCss(read(f))),
].join("\n");
const chipRule = stripComments(allCss).match(
  /\.filter__chip(?:\[[^\]]*\])*\s*\{[^}]*?border\s*:\s*1px\s+solid\s+var\((--[a-z-]+)\)/i,
);
if (!chipRule) {
  fail(
    "could not locate the Work filter chip's default border rule in the built CSS",
  );
} else if (chipRule[1] !== "--color-secondary") {
  fail(
    `Work filter chip default boundary uses ${chipRule[1]}; ENG-103 requires ` +
      "an approved token clearing WCAG 1.4.11 3:1 — use --color-secondary " +
      "(--color-border measures 1.42:1 on white)",
  );
}

/** One built page's route, for the current-link check. */
function emittedRoute(relFile) {
  if (relFile === "index.html") return "/";
  if (relFile.endsWith("/index.html"))
    return `/${relFile.slice(0, -"index.html".length)}`;
  return `/${relFile.replace(/\.html$/i, "")}`;
}

/** Whether a nav link href is the page's own route (or a parent of it). */
function navTargetsRoute(href, route) {
  // Delegates to the app helper so the gate and the site share one rule.
  return isCurrentNavHref(href, route);
}

/**
 * A block-padding declaration is only meaningful if it actually grows the
 * target. Every whitespace-separated component must be non-zero, so `0`, `0px`,
 * `0 0`, `0px 0px` and `0 !important` all fail; `var(--space-xs)` and
 * `calc(...)` pass.
 */
function blockPaddingIsNonZero(value) {
  const tokens = value
    .replace(/!important/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => !/^0(?:[a-z%]+)?$/i.test(t));
}

/** Whether a page's CSS carries a non-zero `padding-block` on the nav anchors. */
function navHasNonZeroBlockPadding(cssText, navClass) {
  const sel = new RegExp(
    `\\.${navClass}(?:\\[[^\\]]*\\])*\\s+a(?:\\[[^\\]]*\\])*\\s*$`,
  );
  return rules(cssText).some((r) => {
    if (!sel.test(r.selector)) return false;
    const m = r.body.match(/padding-block\s*:\s*([^;}]+)/i);
    return m ? blockPaddingIsNonZero(m[1]) : false;
  });
}

/** Classes styled `list-style: none` — their lists need role="list" to survive. */
function listStyleNoneClasses(cssText) {
  const set = new Set();
  for (const r of rules(cssText)) {
    if (!/list-style\s*:\s*none\b/i.test(r.body)) continue;
    for (const c of r.selector.matchAll(/\.([A-Za-z][\w-]*)/g)) set.add(c[1]);
  }
  return set;
}

const NAV_LABELS = ["Primary", "Footer"];
// Union across all shipped CSS: a class styled marker-stripped anywhere forces
// role="list" on every list that carries it, on whatever page it appears.
const markerStrippedClasses = listStyleNoneClasses(allCss);

for (const file of htmlFiles) {
  const relFile = relative(distDir, file).split(sep).join("/");
  const route = emittedRoute(relFile);
  const html = read(file);
  const css = pageCss(html);

  for (const label of NAV_LABELS) {
    const nav = html.match(
      new RegExp(`<nav aria-label="${label}"[\\s\\S]*?</nav>`),
    )?.[0];
    if (!nav) {
      fail(`${route}: no <nav aria-label="${label}"> found`);
      continue;
    }

    // 2. list semantics survive marker removal.
    if (!/<ul[^>]*\brole="list"/.test(nav)) {
      fail(`${route}: ${label} nav <ul> lost role="list" (ENG-103)`);
    }

    // 3. current-page state: exactly the links whose target is this page.
    //    Compare WHICH links are marked, not just how many — a count alone
    //    passes when the wrong link is marked and the right one is not.
    const links = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)];
    const currentHrefs = links
      .filter((m) => /aria-current="page"/.test(m[0]))
      .map((m) => m[1])
      .sort();
    const expectedHrefs = links
      .filter((m) => navTargetsRoute(m[1], route))
      .map((m) => m[1])
      .sort();
    if (JSON.stringify(currentHrefs) !== JSON.stringify(expectedHrefs)) {
      fail(
        `${route}: ${label} nav marks [${currentHrefs.join(", ")}] ` +
          `aria-current, expected [${expectedHrefs.join(", ")}]`,
      );
    }

    // 4. target size: a NON-ZERO block padding on the anchors, read from THIS
    //    page's CSS. Astro scoping makes the rule :global, so it is matched on
    //    the emitted `.primary-nav`/`.footer-nav` anchor selector.
    const navClass = label === "Primary" ? "primary-nav" : "footer-nav";
    if (!navHasNonZeroBlockPadding(css, navClass)) {
      fail(
        `${route}: ${label} nav links carry no non-zero block padding — ` +
          "targets fall below the 24x24 CSS px minimum (ENG-103)",
      );
    }
  }

  // 5. list semantics on every marker-stripped list. Iterate EVERY <ul>/<ol>
  //    on the page (not just the first per class) and cover <ol> as well.
  for (const tag of html.match(/<(?:ul|ol)\b[^>]*>/gi) ?? []) {
    const classes = tag.match(/class="([^"]*)"/)?.[1];
    if (!classes) continue;
    const tokens = classes.split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => markerStrippedClasses.has(t))) continue;
    if (!/\brole="list"/.test(tag)) {
      const name = tag.match(/^<(\w+)/)[1];
      fail(
        `${route}: <${name} class="${classes}"> is marker-stripped ` +
          '(list-style:none) but lost role="list" (ENG-103)',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`check:a11y failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:a11y passed — ${htmlFiles.length} page(s), chip boundary ` +
    `${chipRule?.[1] ?? "?"}, nav semantics + aria-current + target size, ` +
    `${markerStrippedClasses.size} marker-stripped list class(es), 0 problems.`,
);
