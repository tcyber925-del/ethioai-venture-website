#!/usr/bin/env node
/**
 * ENG-107 — deterministic gate for the Work/Research conversion CTA and the
 * reading-clarity measure.
 *
 * Why this is a build-output gate, not a unit test: the contract only exists in
 * the COMPILED markup and CSS. The CTA is a component whose props decide its
 * links (`secondary={false}`), the reading measure lives in Astro-scoped style
 * blocks that ship into hashed CSS files, and the focus indicator is a global
 * rule the minifier rewrites. All three can be correct in source and absent
 * from the page a visitor loads. The failures worth catching live in dist/.
 *
 * Runs after Build, like check:dist / check:seo / check:work / check:fonts /
 * check:pending / check:a11y, because `npm test` runs BEFORE `npm run build` in
 * both `npm run verify` and CI.
 *
 * What it asserts, per built page:
 *   1. /work and /research END with the approved CTA region (the
 *      StartProjectCta markup: a `<section class="cta">`), placed after every
 *      heading on the page so it closes the reading order rather than
 *      interrupting it. ENG-107's conversion requirement is that a visitor
 *      browsing evidence has a route to Start a Project without leaving the
 *      page, and a CTA that renders but sits above the content does not do that;
 *   2. that region's primary action targets /start-a-project and resolves;
 *   3. the region's secondary action does NOT point at the page's own route —
 *      /work must not offer "View Work". This is the assertion that fails if
 *      the `secondary` prop is dropped from either call site, which is exactly
 *      the regression a later "simplify the props" edit would introduce;
 *   4. the Solutions pages keep BOTH actions. Reusing a shared component is how
 *      the prop default gets changed by accident; a page that silently lost
 *      "View Work" is the cost of that accident;
 *   5. no page renders the CTA's pending fallback (the inquiry form is
 *      published, so the honest-absence branch must not be the one that ships);
 *   6. no page's CSS declares a reading measure wider than 60ch. 60ch is the
 *      value the site already ships on the homepage, Solutions and the 404
 *      page; Work and Research carried 70ch/72ch, which with the self-hosted
 *      Inter renders roughly 91-95 characters per line — past the readable
 *      range. The sweep covers EVERY built page, because /about and
 *      /start-a-project were still shipping 72ch while Work and Research were
 *      being fixed. Only `ch` declarations count as reading measures; a `rem`
 *      form width or a `--container-max` cap is not prose and is left alone;
 *   7. the focus indicator that the keyboard journey depends on survives the
 *      build: the page's own CSS still carries a `:focus-visible` rule with a
 *      visible indicator (a non-zero outline width or a non-`none` box-shadow).
 *
 * The measure bound is 60, not "smaller than before", on purpose. A relative
 * assertion passes on 70ch → 68ch, which is still unreadable.
 *
 * Both checks read the page's INLINE <style> blocks as well as the linked
 * bundle. Astro inlines page-level styles, so a gate that only read the linked
 * stylesheet would report green while the page shipped 72ch — the same
 * false-pass class ENG-102 established as the defect worth guarding against.
 *
 * Deliberately NOT asserted here: the actual rendered line length in pixels.
 * That needs a layout engine; this gate reads the declared measure. The
 * measured character-per-line evidence is recorded in the pull request body.
 *
 * Local reproduction: npm run build && npm run check:cta
 * Regression battery: tests/check-cta.test.mjs (fixture dist/ trees).
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = process.argv[2] ?? join(repoRoot, "dist");

const failures = [];
const fail = (message) => failures.push(message);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(
    "check:cta failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

const read = (file) => readFileSync(file, "utf8");

/**
 * The approved CTA region, matched on the built class. The component's own
 * `aria-label="Start a Project"` rides along, so a hand-written
 * `<section class="cta">` elsewhere cannot satisfy the contract.
 */
const CTA_OPEN = /<section[^>]*class="cta"[^>]*>/;

/** The region's markup, from its open tag to the next `</main>`/end of file. */
function ctaRegion(html) {
  const open = html.match(CTA_OPEN);
  if (!open || open.index === undefined) return null;
  const from = open.index;
  const close = html.indexOf("</main>", from);
  return html.slice(from, close === -1 ? undefined : close);
}

/** Hrefs of the anchors inside the region's action row. */
function actionHrefs(region) {
  const row = region.match(
    /<div[^>]*class="cta__actions"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (!row) return [];
  return [...row[1].matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ *
 * Reading measure
 * ------------------------------------------------------------------ */

/**
 * The page's own CSS: the linked stylesheets plus any inline <style> blocks.
 * Page-level Astro styles are inlined into the document, so reading only the
 * linked bundle would make this check pass vacuously — which is precisely the
 * failure mode (a gate that reports green while the page ships 72ch) that
 * ENG-102 established as the bug class worth guarding against.
 */
function pageCss(html) {
  const out = [];
  for (const tag of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)) {
    const href = tag[0].match(/href="([^"]+)"/)?.[1];
    if (!href) continue;
    const file = join(distDir, href.replace(/^\//, ""));
    if (existsSync(file)) out.push({ href, css: read(file) });
  }
  let inlineIndex = 0;
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    inlineIndex += 1;
    out.push({ href: `inline style #${inlineIndex}`, css: block[1] });
  }
  return out;
}

/**
 * Every `max-width` declaration in the CSS, with the selector it belongs to.
 * A `ch` measure is the only unit this site expresses reading width in, so a
 * `ch` value is compared directly. Non-ch lengths (container caps, `rem` form
 * widths) are NOT reading measures and are deliberately left alone — guessing
 * a ch equivalent for `40rem` would flag a form column as unreadable prose.
 */
function measureDeclarations(cssList) {
  const out = [];
  for (const { href, css } of cssList) {
    const rule = /([^{}]*)\{([^}]*)\}/g;
    let match;
    while ((match = rule.exec(css)) !== null) {
      const selector = match[1].trim().split(/[,{]/).pop().trim();
      for (const decl of match[2].matchAll(/max-width\s*:\s*([^;{}]+)/gi)) {
        const raw = decl[1].trim();
        // A reading measure is a bare `Nch`, or a calc() whose ch term is the
        // readable width (`.principles` adds a marker gutter to 60ch).
        for (const ch of raw.matchAll(/([\d.]+)ch/gi)) {
          out.push({ href, selector, raw, ch: Number(ch[1]) });
        }
      }
    }
  }
  return out;
}

const MEASURE_MAX_CH = 60;

/* ------------------------------------------------------------------ *
 * Focus indicator
 * ------------------------------------------------------------------ */

/** True when a declaration list carries a visible focus indicator. */
function hasVisibleIndicator(declarations) {
  const outline = declarations.match(/(?:^|;)\s*outline\s*:\s*([^;]+)/i);
  if (outline) {
    // `outline: 2px solid var(--color-tertiary)` — the width is the first
    // length; `none`, `0` and `medium` (a browser default) do not qualify on
    // their own, so require an explicit non-zero width or an outline-style.
    const width = outline[1]
      .split(/\s+/)
      .map((part) => part.match(/^([\d.]+)(px|rem|em)?$/i))
      .find(Boolean);
    if (width && Number(width[1]) > 0) return true;
    if (/[a-z]/i.test(outline[1]) && !/\bnone\b/i.test(outline[1])) return true;
  }
  const width = declarations.match(/(?:^|;)\s*outline-width\s*:\s*([^;]+)/i);
  if (width) {
    const n = width[1].trim().match(/^([\d.]+)(px|rem|em)?$/i);
    if (n && Number(n[1]) > 0) return true;
  }
  const shadow = declarations.match(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/i);
  if (shadow) {
    // Only a literal `none` or a bare `0` is an absent shadow. Testing for a
    // leading `0` would reject `0 0 0 3px ...`, which is a real focus ring.
    const value = shadow[1].trim().replace(/\s*!important$/i, "");
    if (value !== "" && !/^(none|0)$/i.test(value)) return true;
  }
  return false;
}

function assertFocusIndicator(label, cssList) {
  const rules = cssList
    .flatMap(({ css }) => [
      ...css.matchAll(/(^|[,}])\s*([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g),
    ])
    .map((m) => m[3]);
  if (rules.length === 0) {
    fail(`${label}: no :focus-visible rule survives the build`);
    return;
  }
  if (!rules.some((decls) => hasVisibleIndicator(decls))) {
    fail(
      `${label}: the :focus-visible rules declare no visible indicator — the ` +
        "keyboard journey has no visible focus",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Per-page contracts
 * ------------------------------------------------------------------ */

/** Pages that must carry the conversion CTA, with the route they must not link. */
const CTA_PAGES = [
  { label: "/work", file: "work/index.html", self: "/work" },
  { label: "/research", file: "research/index.html", self: "/research" },
];

for (const { label, file, self } of CTA_PAGES) {
  const path = join(distDir, file);
  if (!existsSync(path)) {
    fail(`${label}: not built`);
    continue;
  }
  const html = read(path);
  const region = ctaRegion(html);
  if (!region) {
    fail(`${label}: no CTA region — the page has no route to Start a Project`);
    continue;
  }

  const hrefs = actionHrefs(region);
  if (!hrefs.includes("/start-a-project")) {
    fail(
      `${label}: the CTA region does not link to /start-a-project ` +
        `(found: ${hrefs.length ? hrefs.join(", ") : "no actions"})`,
    );
  }
  if (hrefs.includes(self)) {
    fail(
      `${label}: the CTA region links to its own route (${self}) — the ` +
        "secondary action must be suppressed on this page",
    );
  }
  if (/cta__pending/.test(region)) {
    fail(
      `${label}: the CTA region renders its pending fallback — the approved ` +
        "inquiry form is published, so the CTA must be the live action",
    );
  }

  // The CTA closes the reading order: no heading may follow it.
  const open = html.search(CTA_OPEN);
  const after = html.slice(open);
  const headingAfter = after.match(/<h[1-6][\s>]/);
  if (headingAfter) {
    fail(
      `${label}: a heading follows the CTA region — the CTA must close the ` +
        "page, not interrupt the content above it",
    );
  }

  assertFocusIndicator(label, pageCss(html));
}

/* ------------------------------------------------------------------ *
 * The reading measure, on every built page
 * ------------------------------------------------------------------ */

/**
 * Applied site-wide, not just to the two CTA pages: the measure is a
 * site-level decision, and leaving a page out of the sweep is how 72ch survived
 * on /about and /start-a-project while /work and /research were being fixed.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.toLowerCase().endsWith(".html")) out.push(full);
  }
  return out;
}

const htmlFiles = walk(distDir).sort();
for (const file of htmlFiles) {
  const label = `/${relative(distDir, file).replace(/index\.html$/, "")}`;
  for (const measure of measureDeclarations(pageCss(read(file)))) {
    if (measure.ch > MEASURE_MAX_CH) {
      fail(
        `${label}: ${measure.selector} sets max-width: ${measure.raw}, about ` +
          `${measure.ch}ch — past the ${MEASURE_MAX_CH}ch editorial measure`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * The Solutions pages keep both actions
 * ------------------------------------------------------------------ */

const solutionsIndex = join(distDir, "solutions/index.html");

if (!existsSync(solutionsIndex)) {
  fail("/solutions: not built");
} else {
  const html = read(solutionsIndex);
  const region = ctaRegion(html);
  if (!region) {
    fail("/solutions: no CTA region");
  } else {
    const hrefs = actionHrefs(region);
    for (const expected of ["/start-a-project", "/work"]) {
      if (!hrefs.includes(expected)) {
        fail(
          `/solutions: the CTA region lost its ${expected} action ` +
            `(found: ${hrefs.length ? hrefs.join(", ") : "no actions"})`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Guard against a vacuous pass
 * ------------------------------------------------------------------ */

if (CTA_PAGES.every(({ file }) => !existsSync(join(distDir, file)))) {
  fail(
    "no CTA page was found in dist/ — this gate would otherwise pass vacuously",
  );
}

if (failures.length > 0) {
  console.error(`check:cta failed with ${failures.length} problem(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log("check:cta passed.");
