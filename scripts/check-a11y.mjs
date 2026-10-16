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
 *      target minimum: the token is resolved (`var(--space-xs)` → 4px, and the
 *      line-height tokens too), padding-block is summed and compared to the
 *      24px minimum, so `0`, `0 0`, `0 !important` and a sub-minimum `0.01px`
 *      all fail. A later `padding`/`padding-block` shorthand override is
 *      honoured. Read from the CSS THAT PAGE actually sees, not the union;
 *   5. every marker-stripped list — `<ul>` OR `<ol>`, whether it carries the
 *      class itself or is styled through a marker-stripped ANCESTOR selector
 *      like `.not-found__nav ul` — still exposes role="list", so the ENG-103
 *      fix is protected beyond the two navs and on every list, not just the
 *      first.
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

/**
 * The chip's PRESSED state must carry a non-colour cue. Raising the default
 * border to --color-secondary left default-vs-pressed at ~1:1 lightness, so the
 * selected chip is now semibold (`font-weight`) — a cue that survives greyscale,
 * CVD and low vision. This asserts a weight/border-width/shadow cue is present
 * on the `[aria-pressed="true"]` block, not just a colour swap, so the fix
 * cannot silently regress.
 */
const pressedRule = stripComments(allCss).match(
  /\.filter__chip(?:\[[^\]]*\])*\[aria-pressed=["']?true["']?\](?:\[[^\]]*\])*\s*\{([^}]*)\}/i,
);
if (!pressedRule) {
  fail(
    "could not locate the Work filter chip's pressed-state rule in the built CSS",
  );
} else {
  const body = pressedRule[1];
  const hasWeight = /font-weight\s*:\s*(?!normal\b|400\b)([^;}]+)/i.test(body);
  const hasThickness =
    /(?:border-width\s*:\s*(?!1px\b)[^;}]+|border\s*:\s*(?!1px\b)[^;}]+)/i.test(
      body,
    );
  const hasShadow = /box-shadow\s*:\s*(?!none\b)[^;}]+/i.test(body);
  if (!hasWeight && !hasThickness && !hasShadow) {
    fail(
      "Work filter chip pressed state has no non-colour cue (ENG-103 AC1): " +
        "the default-vs-pressed borders are ~1:1 in lightness, so the selected " +
        "chip must also change font-weight, border-width or box-shadow",
    );
  }
}

/**
 * Resolve `var(--token)` references in a value using the `:root` custom
 * properties shipped in the CSS. Recursive (a token may alias another), with a
 * depth guard so a self-referential token cannot loop. Lets the target-size
 * check work in pixels instead of trusting any non-zero value.
 */
function resolveTokens(value, tokens, depth = 0) {
  if (depth > 8) return value;
  return value.replace(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi,
    (_, name, fallback) =>
      name in tokens
        ? resolveTokens(tokens[name], tokens, depth + 1)
        : (fallback ?? "").trim(),
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

/** Parse a CSS length to px. `rem`/`em` use the 16px root default; bare `0` is 0. */
function lengthToPx(value) {
  const v = value.trim().toLowerCase();
  if (v === "0") return 0;
  const m = v.match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
}

/**
 * Whether a page's CSS lifts the nav anchors to the 24x24 target minimum.
 * Resolves the `padding-block` token, then the line-height token (font-size is
 * left at the 16px root default, which only makes the estimate conservative),
 * sums the two padding halves plus the line box, and requires ≥24px. A later
 * `padding` or `padding-block` shorthand is honoured (it overrides the earlier
 * longhand, so a `padding:0` cascade is caught). Returns false when the value
 * cannot be resolved to px — an unverifiable target is not a passing one.
 */
function navMeetsTargetSize(cssText, navClass) {
  const tokens = {};
  for (const r of rules(cssText)) {
    if (!/(^|,)\s*:root\s*(,|$)/.test(r.selector)) continue;
    for (const d of r.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
      tokens[d[1]] = d[2].trim();
    }
  }

  const anchorSel = new RegExp(
    `\\.${navClass}(?:\\[[^\\]]*\\])*\\s+a(?:\\[[^\\]]*\\])*\\s*$`,
  );
  const navSel = new RegExp(`\\.${navClass}(?:\\[[^\\]]*\\])*`);
  let paddingBlock = null;
  let anchorLineHeight = null;
  let navFontSize = null;
  let navLineHeight = null;
  for (const r of rules(cssText)) {
    if (!navSel.test(r.selector)) continue;
    const isAnchor = anchorSel.test(r.selector);
    const pb = r.body.match(/(?:^|;)\s*padding-block\s*:\s*([^;}]+)/i);
    const p = r.body.match(/(?:^|;)\s*padding\s*:\s*([^;}]+)/i);
    const lh = r.body.match(/(?:^|;)\s*line-height\s*:\s*([^;}]+)/i);
    const fs = r.body.match(/(?:^|;)\s*font-size\s*:\s*([^;}]+)/i);
    if (isAnchor) {
      if (p) paddingBlock = p[1];
      if (pb) paddingBlock = pb[1];
      if (lh) anchorLineHeight = lh[1];
    }
    if (fs) navFontSize = fs[1];
    if (lh) navLineHeight = lh[1];
  }
  if (!paddingBlock) return false;

  const parts = resolveTokens(paddingBlock, tokens)
    .replace(/!important/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(lengthToPx);
  if (parts.length === 0 || parts.some((n) => n === null)) return false;
  // 1–4 values → the two block halves. `padding: a b` → block = a; `a b c d` → a + c.
  const blockPx = parts.length === 4 ? parts[0] + parts[2] : parts[0] * 2;
  if (blockPx <= 0) return false;

  // Line box: prefer the anchor's own line-height, else the nav's; a unitless
  // factor multiplies the nav font-size. Defaults are the 16px root and 1.2×.
  const fontPx = navFontSize
    ? (lengthToPx(resolveTokens(navFontSize, tokens)) ?? 16)
    : 16;
  const rawLine = anchorLineHeight ?? navLineHeight;
  const resolvedLine = rawLine ? resolveTokens(rawLine, tokens).trim() : null;
  let linePx;
  if (resolvedLine && /^\d*\.?\d+$/.test(resolvedLine)) {
    linePx = Number(resolvedLine) * fontPx; // unitless factor
  } else if (resolvedLine) {
    linePx = lengthToPx(resolvedLine);
  }
  if (linePx === null || linePx === undefined) linePx = 1.2 * fontPx;

  return blockPx + linePx >= 24;
}

/**
 * Selectors that strip list markers. Matches the `list-style` shorthand and the
 * `list-style-type` longhand, so `.foo{list-style-type:none}` is caught too.
 */
const MARKER_NONE = /list-style(?:-type)?\s*:\s*none\b/i;

/**
 * Whether a list element is marker-stripped, either by a class it carries or by
 * an ANCESTOR-styled selector like `.not-found__nav ul` (the 404's classless
 * list). `tag` is the raw opening tag; `ancestorClasses` are the class tokens of
 * its enclosing elements (walked by the caller).
 */
function isMarkerStripped(tag, ancestorClasses, cssText) {
  const name = tag.match(/^<(\w+)/)?.[1]?.toLowerCase();
  if (!name) return false;
  const own = (tag.match(/class="([^"]*)"/)?.[1] ?? "")
    .split(/\s+/)
    .filter(Boolean);
  for (const r of rules(cssText)) {
    if (!MARKER_NONE.test(r.body)) continue;
    for (const group of r.selector.split(",")) {
      // Drop Astro's scoping attributes so
      // `.a[data-astro-cid-x] ul[data-astro-cid-x]` reads as `.a ul`.
      const parts = group
        .replace(/\[[^\]]*\]/g, "")
        .trim()
        .split(/[\s>+~]+/)
        .filter(Boolean);
      if (parts.length === 0) continue;
      const last = parts[parts.length - 1].toLowerCase();
      if (last === name) {
        // Ancestor-styled list, e.g. `.not-found__nav ul`.
        for (const p of parts.slice(0, -1)) {
          for (const c of p.matchAll(/\.([A-Za-z][\w-]*)/g)) {
            if (ancestorClasses.has(c[1])) return true;
          }
        }
      }
      // Class-carried list, e.g. `.card-grid`.
      for (const c of group.matchAll(/\.([A-Za-z][\w-]*)/g)) {
        if (own.includes(c[1])) return true;
      }
    }
  }
  return false;
}

const NAV_LABELS = ["Primary", "Footer"];

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

    // 4. target size: the padding token is resolved to px and the sum of the
    //    block halves plus the line box must reach 24px, read from THIS page's
    //    CSS. Astro scoping makes the rule :global, so it is matched on the
    //    emitted `.primary-nav`/`.footer-nav` anchor selector.
    const navClass = label === "Primary" ? "primary-nav" : "footer-nav";
    if (!navMeetsTargetSize(css, navClass)) {
      fail(
        `${route}: ${label} nav links do not reach the 24x24 CSS px target ` +
          "minimum (ENG-103)",
      );
    }
  }

  // 5. list semantics on every marker-stripped list. Iterate EVERY <ul>/<ol>
  //    on the page (not just the first per class), cover <ol> as well, and
  //    detect marker removal by class OR by a marker-stripped ANCESTOR selector
  //    (the 404's classless `.not-found__nav ul`).
  const stripped = (text) => {
    const stack = []; // [{ name, classes:Set }]
    for (const tag of text.match(
      /<\/?(?:ul|ol|nav|div|section|aside|main|header|footer|article)\b[^>]*>/gi,
    ) ?? []) {
      const close = /^<\//.test(tag);
      const name = tag.match(/^<\/?(\w+)/)[1].toLowerCase();
      if (close) {
        const i = stack.map((e) => e.name).lastIndexOf(name);
        if (i >= 0) stack.splice(i, 1);
        continue;
      }
      const classes = new Set(
        (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean),
      );
      if (name === "ul" || name === "ol") {
        const ancestors = new Set(stack.flatMap((e) => [...e.classes]));
        if (
          isMarkerStripped(tag, ancestors, css) &&
          !/\brole="list"/.test(tag)
        ) {
          const cls = [...classes].join(" ");
          fail(
            `${route}: <${name}${cls ? ` class="${cls}"` : ""}> is ` +
              'marker-stripped but lost role="list" (ENG-103)',
          );
        }
      }
      stack.push({ name, classes });
    }
  };
  stripped(html);
}

if (failures.length > 0) {
  console.error(`check:a11y failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:a11y passed — ${htmlFiles.length} page(s), chip boundary ` +
    `${chipRule?.[1] ?? "?"}, nav semantics + aria-current + target size, ` +
    "marker-stripped lists gated (class + ancestor selectors), 0 problems.",
);
