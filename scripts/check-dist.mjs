#!/usr/bin/env node
/**
 * ENG-87 — deterministic post-build checks on dist/.
 *
 * Spec 07 "Verification contract": accessibility/static checks, deterministic
 * SEO checks and "link/assets validation where reliable". Boundary: this is
 * automated regression protection only — manual visual, responsive,
 * interaction and production-like QA stays in ENG-86 (spec 06).
 *
 * Per generated page (markup outside inline <script> bodies):
 *   - non-empty <html lang>
 *   - non-empty <title>
 *   - meta name="description" present and non-empty
 *   - meta name="viewport" present
 *   - exactly one <h1>
 * Across pages:
 *   - every internal href/src/srcset reference — root-relative or relative,
 *     percent-encoded paths decoded — resolves to a built file (zero dead
 *     links). CSS-internal url() references are not validated (would require
 *     parsing stylesheets); that stays in ENG-86's manual asset checks.
 *
 * Local reproduction: npm run build && npm run check:dist
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

if (!existsSync(distDir)) {
  console.error(
    "check:dist failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

const htmlFiles = walk(distDir).filter((f) => f.endsWith(".html"));
if (htmlFiles.length === 0) {
  console.error("check:dist failed — no HTML files in dist/.");
  process.exit(1);
}

/**
 * Does a normalized internal pathname resolve to a built file?
 * Percent-encoded paths (e.g. non-ASCII slugs) are decoded first; normalizing
 * with a leading "/" collapses any ".." segments so the check can never
 * escape dist/.
 */
function targetResolves(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // malformed percent-encoding — check the raw path instead of crashing
  }
  const norm = posix.normalize("/" + decoded.replace(/^\/+/, ""));
  const rel = norm.slice(1);
  const candidates = norm.endsWith("/")
    ? [join(rel, "index.html")]
    : [rel, `${rel}.html`, join(rel, "index.html")];
  // isFile, not existsSync: a directory alone does not serve (no index.html
  // inside means the static host 404s the directory URL).
  return candidates.some((c) => isFile(join(distDir, c)));
}

const failures = [];
let referencesChecked = 0;

for (const file of htmlFiles) {
  const relFile = relative(distDir, file).split(sep).join("/");
  const route = "/" + relFile.replace(/(^|\/)index\.html$/, "$1");
  const raw = readFileSync(file, "utf8");
  // Drop inline script bodies (JS strings are not markup — a "<h1>" or
  // href="..." inside a script must not count), keeping <script src=...>
  // tags so asset references are still checked.
  const html = raw.replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  if (!/<html[^>]*\slang="[^"]+"/.test(html)) {
    fail("missing or empty <html lang>");
  }

  const title = html.match(/<title>([^<]*)<\/title>/);
  if (!title || !title[1].trim()) fail("missing or empty <title>");

  const desc =
    html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/) ??
    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"/);
  if (!desc || !desc[1].trim()) fail("missing or empty meta description");

  if (!/<meta[^>]*name="viewport"/.test(html)) fail("missing meta viewport");

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) fail(`expected exactly one <h1>, found ${h1Count}`);

  // Base for resolving relative references against this page's URL directory.
  const pageDir = posix.dirname("/" + relFile); // "/" or "/about"
  const base =
    "http://check.dist" + (pageDir.endsWith("/") ? pageDir : `${pageDir}/`);

  /** Check one raw reference (href/src value or srcset entry). */
  const checkReference = (target, kind) => {
    if (target.startsWith("//")) return; // protocol-relative → external
    if (target.startsWith("#") || target.startsWith("?")) return; // same-document
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // http:, mailto:, data: …
    let pathname;
    if (target.startsWith("/")) {
      pathname = target;
    } else {
      try {
        pathname = new URL(target, base).pathname;
      } catch {
        fail(`unparseable ${kind}: ${target}`);
        return;
      }
    }
    referencesChecked += 1;
    if (!targetResolves(pathname)) fail(`dead internal ${kind}: ${target}`);
  };

  // External URLs, in-page anchors and mailto: are out of scope — this is
  // the deterministic internal link/assets check ("where reliable").
  for (const [, target] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    checkReference(target, "link");
  }

  for (const [, srcset] of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    if (srcset.includes("data:")) continue; // inline data URIs are external
    for (const entry of srcset.split(",")) {
      const candidate = entry.trim().split(/\s+/)[0];
      if (candidate) checkReference(candidate, "srcset target");
    }
  }
}

if (failures.length > 0) {
  console.error(`check:dist failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:dist passed — ${htmlFiles.length} page(s), ${referencesChecked} internal reference(s), 0 problems.`,
);
