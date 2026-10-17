#!/usr/bin/env node
/**
 * ENG-103 — deterministic regression checks for the Batch 2 accessibility
 * and navigation fixes, extended by ENG-106 with the /work card single-target
 * contract.
 * and navigation fixes, plus the ENG-107 in-content conversion CTA.
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
 *      first;
 *   6.–9. on pages that render work cards, the ENG-106 single-hit-target
 *      contract: exactly one interactive element per card, a positioning
 *      context plus a zero-inset absolute overlay on the card's anchor, a
 *      border-color change on both :hover and :focus-within, and a
 *      prefers-reduced-motion override that neutralises the card transition.
 *   6. the two evidence indexes each ship exactly ONE in-content "Start a
 *      Project" anchor inside <main> — scoped to <main> on purpose, because
 *      the header and footer nav items point at the same route on every page
 *      and must not be counted — labelled with the approved wording, placed
 *      AFTER the evidence it converts from (.project-card on /work;
 *      .entry-list or .empty-state on /research, whichever that page ships,
 *      and only checked when it ships one), and, on /research, not a
 *      descendant of the empty-state panel (ENG-107).
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ENG-106 — the /work project card is one hit target across its whole surface.
 *
 * The card root is the positioning context and the card's existing title anchor
 * carries a stretched `::after` overlay, so the entire card activates the one
 * link that already ships: no second anchor, no wrapper element, no click
 * handler, and therefore still exactly one tab stop per card.
 *
 * All four facts below exist only in the COMPILED output, and each can be lost
 * without any source-level error (a dropped rule tree-shakes away, `:global()`
 * can compile to a selector matching nothing, an added button type-checks
 * fine), which is why they belong in this gate rather than in a component test:
 *
 *   6. every .project-card still holds exactly ONE interactive element — one
 *      <a>, no <button> and no other focusable control;
 *   7. the card root establishes a positioning context AND the card's anchor
 *      carries an absolutely positioned overlay at zero inset;
 *   8. the card root changes border-color to a token on :hover AND on
 *      :focus-within (the ResearchCard card-state treatment, so the state is
 *      visible to pointer AND keyboard users);
 *   9. a prefers-reduced-motion block neutralises that transition.
 *
 * 8 and 9 are deliberately narrow. global.css already blanket-sets
 * `transition-duration: .01ms !important` on `*` under reduced motion, so a
 * loose matcher would be satisfied by that rule and prove nothing about the
 * card; and `:hover` alone would leave keyboard users with no state. Each
 * therefore requires a rule that targets `.project-card` ITSELF.
 */

/** Strip Astro's injected scoping attributes; the emitted CSS has both. */
const unscope = (selector) => selector.replace(/\[[^\]]*\]/g, "").trim();

/** A selector group's comma-separated halves, unscoped, normalised. */
const selectorGroups = (selector) => selector.split(",").map(unscope);

/**
 * A group that targets the card ROOT — `.project-card`, optionally followed by
 * pseudo-classes such as `:hover`. Anchored at the end so a descendant or
 * child selector (`.project-card .project-card__title`) cannot pass as the root.
 * Note `.project-card__title` must not match: the negative lookahead rejects
 * the `__` continuation of the BEM class.
 */
const CARD_ROOT = /\.project-card(?![\w-])(?::[\w-]+(?:\([^)]*\))?)*$/;

/**
 * A group that targets the card's ANCHOR, with or without the overlay
 * pseudo-element. `a$` alone would also match `.project-card__meta`, so the
 * preceding combinator is required. The pseudo-element is accepted in either
 * spelling because Astro's minifier emits `a:after` with ONE colon.
 */
const CARD_ANCHOR = /\.project-card[\w\s>+~:()=-]*\ba(?::{1,2}after)?$/;

/** Zero inset, either as the shorthand or as all four longhands at 0. */
const ZERO_INSET =
  /(?:^|;)\s*inset\s*:\s*0(?:\s+0)*\s*(?:!important)?\s*(?:;|$)/i;
const allFourZero = (body) =>
  ["top", "right", "bottom", "left"].every((side) =>
    new RegExp(
      `(?:^|;)\\s*${side}\\s*:\\s*0(?:px|%)?\\s*(?:!important)?\\s*(?:;|$)`,
      "i",
    ).test(body),
  );

/**
 * The bodies of every `prefers-reduced-motion` at-rule, so a check can require a
 * rule targeting the card rather than matching global.css's blanket `*`
 * override. Brace-matched, so a nested block is read whole.
 */
function reducedMotionBodies(cssText) {
  const out = [];
  const text = stripComments(cssText);
  const re = /@media([^{]*prefers-reduced-motion[^{]*)\{/gi;
  while (re.exec(text) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(text.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return out;
}

/**
 * The inner HTML of every `.project-card` on the page. ProjectCard renders no
 * nested <li>, so the first `</li>` after the opening tag is the card's own
 * close; if that ever stops being true the extraction is what fails, not a
 * silently weakened assertion.
 */
function projectCards(html) {
  const out = [];
  const open = /<li\b[^>]*\bclass="[^"]*\bproject-card\b[^"]*"[^>]*>/gi;
  let match;
  while ((match = open.exec(html)) !== null) {
    const close = html.indexOf("</li>", open.lastIndex);
    out.push(html.slice(match.index, close === -1 ? html.length : close));
  }
  return out;
}

/** Focusable controls that are neither an anchor nor a button. */
const OTHER_CONTROLS =
  /<(?:input|select|textarea)\b|\btabindex\s*=\s*["']?(?!-1\b)[-\d]/i;

/**
 * Card assertions 6–9. `css` is the CSS THIS page sees (its linked stylesheets
 * plus its inline <style>), so a page that lost the card's rules fails its own
 * check rather than borrowing another page's.
 */
function checkWorkCards(route, html, css) {
  const cards = projectCards(html);
  if (cards.length === 0) return;

  // 6. one interactive element — one anchor, no button, nothing else focusable.
  cards.forEach((card, index) => {
    const anchors = (card.match(/<a\b/gi) ?? []).length;
    const buttons = (card.match(/<button\b/gi) ?? []).length;
    if (anchors !== 1) {
      fail(
        `${route}: .project-card #${index + 1} holds ${anchors} <a> element(s); ` +
          "ENG-106 requires exactly one interactive element (one tab stop) per card",
      );
    }
    if (buttons > 0 || OTHER_CONTROLS.test(card)) {
      fail(
        `${route}: .project-card #${index + 1} holds a control beyond its title ` +
          `link (${buttons} <button>); ENG-106 requires exactly one interactive ` +
          "element per card",
      );
    }
  });

  // The card root's DEFAULT boundary token, so the hover/focus state can be
  // required to actually CHANGE it. Without this a rule that re-states
  // `border-color: var(--color-border)` would satisfy the check vacuously.
  let defaultBorderToken = null;
  for (const r of rules(css)) {
    const root = selectorGroups(r.selector).find((g) => CARD_ROOT.test(g));
    if (!root) continue;
    const token = r.body.match(
      /(?:^|;)\s*border\s*:\s*[^;}]*?var\(\s*(--[a-z0-9-]+)\s*\)/i,
    );
    if (token) defaultBorderToken = token[1];
  }

  // 7. positioning context on the root + a zero-inset absolute overlay on the
  //    card's anchor. Astro emits the pseudo-element as `a:after` (one colon),
  //    so both spellings are accepted by CARD_ANCHOR.
  let positionsRoot = false;
  let hasOverlay = false;
  for (const r of rules(css)) {
    for (const group of selectorGroups(r.selector)) {
      if (
        CARD_ROOT.test(group) &&
        /(?:^|;)\s*position\s*:\s*relative\s*(?:!important)?\s*(?:;|$)/i.test(
          r.body,
        )
      ) {
        positionsRoot = true;
      }
      if (
        CARD_ANCHOR.test(group) &&
        /(?:^|;)\s*position\s*:\s*absolute\s*(?:!important)?\s*(?:;|$)/i.test(
          r.body,
        ) &&
        (ZERO_INSET.test(r.body) || allFourZero(r.body))
      ) {
        hasOverlay = true;
      }
    }
  }
  if (!positionsRoot) {
    fail(
      `${route}: the .project-card root does not establish a positioning ` +
        "context (position: relative); ENG-106's card overlay needs one to " +
        "stretch across the card",
    );
  }
  if (!hasOverlay) {
    fail(
      `${route}: the .project-card anchor carries no absolutely positioned ` +
        "zero-inset overlay; ENG-106 requires the whole card surface to " +
        "activate the one title link",
    );
  }

  // 8. border-color to a DIFFERENT token on :hover and on :focus-within.
  const hoverToken = (() => {
    let found = null;
    for (const r of rules(css)) {
      const isHover = selectorGroups(r.selector).some(
        (g) => CARD_ROOT.test(g) && /:hover\b/.test(g),
      );
      if (!isHover) continue;
      const token = r.body.match(
        /(?:^|;)\s*border-color\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/i,
      );
      if (token) found ??= token[1];
    }
    return found;
  })();
  const focusToken = (() => {
    let found = null;
    for (const r of rules(css)) {
      const isFocus = selectorGroups(r.selector).some(
        (g) => CARD_ROOT.test(g) && /:focus-within\b/.test(g),
      );
      if (!isFocus) continue;
      const token = r.body.match(
        /(?:^|;)\s*border-color\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/i,
      );
      if (token) found ??= token[1];
    }
    return found;
  })();

  const unchanged =
    defaultBorderToken !== null &&
    hoverToken === defaultBorderToken &&
    focusToken === defaultBorderToken;
  if (hoverToken === null || focusToken === null) {
    const missing = [
      ...(hoverToken === null ? [":hover"] : []),
      ...(focusToken === null ? [":focus-within"] : []),
    ];
    fail(
      `${route}: the .project-card root has no ${missing.join(" and no ")} ` +
        "rule setting border-color to a token; ENG-106 requires both (the " +
        "ResearchCard card-state treatment, visible to pointer AND keyboard " +
        "users)",
    );
  } else if (unchanged) {
    fail(
      `${route}: the .project-card :hover / :focus-within state re-states the ` +
        `default boundary token (${defaultBorderToken}); ENG-106 requires a ` +
        "VISIBLE change of boundary on hover and keyboard focus",
    );
  }

  // 9. the card's own transition neutralised under reduced motion — a rule on
  //    `.project-card` inside the at-rule, not global.css's blanket `*` reset.
  const neutralised = reducedMotionBodies(css).some((body) =>
    rules(body).some(
      (r) =>
        selectorGroups(r.selector).some((g) => CARD_ROOT.test(g)) &&
        /(?:^|;)\s*transition\s*:\s*none\b/i.test(r.body),
    ),
  );
  if (!neutralised) {
    fail(
      `${route}: no prefers-reduced-motion rule neutralises the .project-card ` +
        "transition; ENG-106 requires the card transition to be disabled when " +
        "the user asks for reduced motion",
    );
  }
}

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

  // 6–9. the /work project card's single-hit-target contract (ENG-106). A
  //    no-op on pages that render no cards.
  checkWorkCards(route, html, css);
}

/*
 * 6. ENG-107 — the in-content conversion CTA on the two evidence indexes.
 *
 * Why the build output: the count, the label, the position and the
 * empty-state nesting are all facts about the COMPILED page. A source edit
 * can leave the CTA in the wrong branch of a ternary, nest it inside the
 * empty state, or add a second one, and only dist/ shows it.
 *
 * Scope: the assertions run on a page that (a) was built and (b) carries a
 * `<main>` region — i.e. a real BaseLayout page. A route with no built file is
 * another gate's invariant (check:dist / check:seo own route presence), and a
 * page with no `<main>` has no in-content region to assert about, so neither is
 * claimed here. Both indexes are always laid out in the real build, so every
 * assertion below runs in CI.
 */

const CTA_HREF = "/start-a-project";
const CTA_LABEL = "Start a Project";

/** The evidence block each index converts from, first match wins. */
const CTA_ROUTES = [
  { route: "/work", evidence: ["project-card"], lastOf: true },
  {
    route: "/research",
    evidence: ["entry-list", "empty-state"],
    lastOf: false,
  },
];

/** The `[start, end)` offsets of the page's <main> region. */
function mainRegion(html) {
  const start = html.search(/<main\b/i);
  if (start === -1) return null;
  const end = html.indexOf("</main>", start);
  return end === -1 ? null : { start, end };
}

/** An element's visible text: tags dropped, whitespace collapsed. */
const textOf = (inner) =>
  inner
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Offsets of every `class="…"` attribute whose value carries `cls` as a token. */
function classIndexes(text, cls) {
  const out = [];
  for (const m of text.matchAll(/class="([^"]*)"/g)) {
    if (m[1].split(/\s+/).includes(cls)) out.push(m.index);
  }
  return out;
}

/**
 * `[start, end)` of the element carrying the `class="…"` attribute at `attr`,
 * found by counting same-name tags from the `<` that opens it.
 */
function elementRange(html, attr) {
  const open = html.lastIndexOf("<", attr);
  const name = html.slice(open).match(/^<(\w+)/)?.[1];
  if (!name) return null;
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  tag.lastIndex = open;
  let depth = 0;
  let m;
  while ((m = tag.exec(html)) !== null) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return { start: open, end: m.index };
    } else if (!/\/>$/.test(m[0].trimEnd())) {
      depth += 1;
    }
  }
  return null;
}

for (const { route, evidence, lastOf } of CTA_ROUTES) {
  const file = join(distDir, route.replace(/^\//, ""), "index.html");
  if (!existsSync(file)) continue;
  const html = read(file);
  const region = mainRegion(html);
  if (!region) continue;
  // Everything below is measured inside <main>, so the header/footer nav
  // items — expected on every page — can never be read as an in-content CTA.
  const slice = html.slice(region.start, region.end);

  const anchors = [
    ...slice.matchAll(
      new RegExp(`<a\\b[^>]*href="${CTA_HREF}"[^>]*>([\\s\\S]*?)</a>`, "g"),
    ),
  ];

  if (anchors.length !== 1) {
    fail(
      `${route}: expected exactly one in-content "${CTA_LABEL}" CTA inside ` +
        `<main>, found ${anchors.length}`,
    );
    continue;
  }
  const cta = anchors[0];

  const label = textOf(cta[1]);
  if (label !== CTA_LABEL) {
    fail(
      `${route}: in-content CTA text is "${label}"; ENG-107 requires ` +
        `exactly "${CTA_LABEL}"`,
    );
  }

  // Evidence first: whichever block this page ships, the CTA follows it.
  const shipped = evidence.filter((cls) => classIndexes(slice, cls).length > 0);
  const [evidenceClass] = shipped;
  if (evidenceClass) {
    const indexes = classIndexes(slice, evidenceClass);
    const boundary = lastOf ? indexes[indexes.length - 1] : indexes[0];
    if (cta.index < boundary) {
      fail(
        `${route}: in-content CTA appears before the ${lastOf ? "last " : ""}` +
          `.${evidenceClass}; evidence must come first (ENG-107)`,
      );
    }
  }

  // The research CTA is a sibling of the empty state, never part of it: a CTA
  // inside the panel would imply research exists.
  if (route === "/research") {
    for (const open of classIndexes(slice, "empty-state")) {
      const range = elementRange(slice, open);
      const inside =
        range && cta.index >= range.start && cta.index <= range.end
          ? true
          : false;
      if (inside) {
        fail(
          `${route}: in-content CTA sits inside the empty state; it must ` +
            "follow the empty-state panel (ENG-107)",
        );
      }
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
    "marker-stripped lists gated (class + ancestor selectors), work-card " +
    "single-target + overlay + hover/focus + reduced-motion gated, " +
    "0 problems.",
    "marker-stripped lists gated (class + ancestor selectors), one " +
    "in-content CTA per evidence index gated, 0 problems.",
);
