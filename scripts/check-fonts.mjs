#!/usr/bin/env node
/**
 * ENG-102 — deterministic gate for the self-hosted Inter subsets.
 *
 * Why this is a build-output gate and not a unit test: the failures worth
 * catching here only exist in the COMPILED CSS. `src/styles/fonts.css` can
 * declare a correct `@font-face` while the shipped stylesheet does not, and
 * one specific class of defect is invisible until Astro's minifier has run —
 *
 *   the minifier rewrites any `unicode-range` token starting at 0
 *   (`U+0000-00FF`, or `U+0-FF`) into the literal bytes `U+??`, which is not
 *   valid CSS. Chromium recovers it because its parser treats `?` as a
 *   wildcard and resolves the token to U+0-FF; another engine can drop the
 *   whole descriptor, at which point the entire Latin block silently falls back
 *   to a system font — which is precisely the pre-ENG-102 state this issue
 *   exists to fix.
 *
 * The mitigation is `U+0001-00FF` in the source (U+0000 is NULL and never
 * rendered). This gate is what proves the mitigation survived the build.
 *
 * It also runs after Build in CI and in `npm run verify`, which is the only
 * place `dist/` exists: `npm test` runs BEFORE `npm run build`, so a check that
 * read `dist/` from the test suite would fail on every clean checkout.
 * Same split as check:dist / check:seo / check:work.
 *
 * Local reproduction: npm run build && npm run check:fonts
 * Regression battery: npm test (tests/fonts.test.mjs) — builds fixture dist/
 * trees by hand so the gate's verdicts are proven, not assumed.
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Default to the repo's dist/; an explicit path is taken as-is (the battery).
const distDir = process.argv[2] ? process.argv[2] : join(repoRoot, "dist");

const failures = [];
const fail = (message) => failures.push(message);

/** All files under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(
    "check:fonts failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

const distFiles = walk(distDir);
const cssFiles = distFiles.filter((f) => f.toLowerCase().endsWith(".css"));
if (cssFiles.length === 0) {
  console.error("check:fonts failed — no CSS output in dist/.");
  process.exit(1);
}

// The font subset the site actually loads. `inter-latin-ext` is shipped but is
// gated by unicode-range, so no current page fetches it; its presence is still
// required so later accented content cannot fall back to a non-Inter face.
const REQUIRED_ASSETS = [
  "fonts/inter-latin.woff2",
  "fonts/inter-latin-ext.woff2",
  // OFL 1.1 requires the licence to accompany the binaries.
  "fonts/LICENSE.txt",
];

for (const asset of REQUIRED_ASSETS) {
  if (!existsSync(join(distDir, asset))) {
    fail(`missing emitted asset: ${asset}`);
  }
}

const css = cssFiles.map((file) => readFileSync(file, "utf8")).join("\n");

// 1. The face must survive the build. Astro inlines some component CSS into
//    page <style> blocks; @font-face lives in the global stylesheet, but the
//    check reads every emitted stylesheet so a future move cannot blind it.
if (!/@font-face\s*\{\s*font-family:\s*Inter/.test(css)) {
  fail("no @font-face for Inter in the built stylesheets");
}

// 2. Every unicode-range must be intact. `U+??` is the minifier's corrupt
//    output for a range starting at 0 and must never survive a build.
const ranges = css.match(/unicode-range:\s*[^;}]+/g) ?? [];
if (ranges.length === 0) {
  fail(
    "no unicode-range found — the faces are ungated and the ext subset is dead weight",
  );
}
for (const range of ranges) {
  // `U+??` — note the plus sign. The minifier's corruption of a range
  // starting at U+0000 is the two-character wildcard, so `U?` cannot match
  // and `U??` would never fire on the very string it exists to catch.
  if (range.includes("U+??")) {
    fail(
      `minifier-corrupted unicode-range (${range.trim()}) — a range starting at ` +
        "U+0000 builds to the invalid bytes `U+??`; use U+0001-00FF (NULL is " +
        "never rendered)",
    );
  }
  if (!/unicode-range:\s*U\+[0-9a-f]/i.test(range)) {
    fail(`malformed unicode-range: ${range.trim()}`);
  }
}
if (ranges.length !== 2) {
  fail(
    `expected 2 unicode-range declarations (latin + latin-ext), found ${ranges.length}`,
  );
}

// 3. The latin face must cover basic Latin AND U+2192. The homepage Geography
//    section and /about render "Ethiopia → Africa → Global"; Google's
//    published Inter subset omits that codepoint, so a stock subset renders a
//    system arrow inside an Inter heading.
const latinFace = css.match(
  /url\(\/?(?:[^)]*\/)?inter-latin\.woff2\)\s*format\("woff2"\)\s*;\s*unicode-range:\s*([^;}]+)/,
);
if (!latinFace) {
  fail("could not locate the latin face's declaration in the built stylesheet");
} else {
  const range = latinFace[1];
  if (!/U\+0?1-FF/i.test(range)) {
    fail(
      `the latin range does not start at U+0001-00FF (found: ${range.slice(0, 40)})`,
    );
  }
  if (!range.includes("U+2192")) {
    fail(
      "the latin range omits U+2192 (→) — the arrows the site renders would " +
        "fall back to a system font mid-heading",
    );
  }
}

// 4. font-display: swap, so no text is ever invisible.
if (!/@font-face\s*\{[^}]*font-display:\s*swap/.test(css)) {
  fail("no Inter face declares font-display: swap (text could stay invisible)");
}

// 5. The faces must be self-hosted. check:dist deliberately treats absolute
//    URLs as external and skips them; a font-CDN reference is exactly what this
//    has to catch.
const TEXT_ASSET = /\.(?:html?|js|mjs|css|json|svg|xml|txt|map)$/i;
const CDN =
  /fonts\.(?:googleapis|gstatic|jsdelivr)\.com|use\.typekit\.net|fonts\.bunny\.net/i;
for (const file of distFiles.filter((f) => TEXT_ASSET.test(f))) {
  const text = readFileSync(file, "utf8");
  if (CDN.test(text)) {
    fail(
      `${relative(distDir, file).split(sep).join("/")}: references an external ` +
        "font host — the fonts must be self-hosted",
    );
  }
}

// 6. Every page preloads the latin face, with crossorigin (font fetches are
//    always CORS mode; a preload without it is fetched twice). latin-ext is
//    deliberately NOT preloaded — no page needs a codepoint it covers.
const htmlFiles = distFiles.filter((f) => f.toLowerCase().endsWith(".html"));
for (const file of htmlFiles) {
  const text = readFileSync(file, "utf8");
  const route =
    "/" +
    relative(distDir, file)
      .split(sep)
      .join("/")
      .replace(/(^|\/)index\.html$/i, "$1");
  if (!/<link\s[^>]*rel="preload"[^>]*>/i.test(text)) {
    fail(`${route}: no font preload`);
    continue;
  }
  const preload = text.match(/<link\s[^>]*rel="preload"[^>]*>/i)[0];
  if (!preload.includes("inter-latin.woff2")) {
    fail(`${route}: preload does not point at the latin subset`);
  }
  if (!/as="font"/i.test(preload)) {
    fail(`${route}: font preload is missing as="font"`);
  }
  if (!/\bcrossorigin\b/i.test(preload)) {
    fail(
      `${route}: font preload is missing crossorigin (it would be fetched twice)`,
    );
  }
  if (preload.includes("inter-latin-ext")) {
    fail(`${route}: preloads inter-latin-ext, which no page needs`);
  }
}

if (failures.length > 0) {
  console.error(`check:fonts failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:fonts passed — ${cssFiles.length} stylesheet(s), ` +
    `${htmlFiles.length} page preload(s), ${REQUIRED_ASSETS.length} asset(s), ` +
    "0 problems.",
);
