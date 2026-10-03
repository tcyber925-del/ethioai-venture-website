#!/usr/bin/env node
/**
 * ENG-87 — deterministic post-build checks on dist/.
 *
 * Spec 07 "Verification contract": accessibility/static checks, deterministic
 * SEO checks and "link/assets validation where reliable". Boundary: this is
 * automated regression protection only — manual visual, responsive,
 * interaction and production-like QA stays in ENG-86 (spec 06).
 *
 * Per generated page (rendered markup — inline <script> bodies and HTML
 * comments are stripped first; attributes are matched with either quote
 * style):
 *   - non-empty <html lang>
 *   - non-empty <title>
 *   - meta name="description" present and non-empty (either attribute order)
 *   - meta name="viewport" present and non-empty (either attribute order)
 *   - exactly one <h1>
 * Across pages:
 *   - every internal href/src/srcset reference — root-relative or relative,
 *     query/fragment stripped, percent-encoded paths decoded — resolves to a
 *     built file (zero dead links). CSS-internal url() references are not
 *     validated (would require parsing stylesheets); that stays in ENG-86's
 *     manual asset checks.
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
 * Syntactic query/fragment delimiters are stripped first (`/about#team` →
 * `/about`), then percent-encoded paths (e.g. non-ASCII slugs) are decoded;
 * normalizing with a leading "/" collapses any ".." segments so the check
 * can never escape dist/.
 */
function targetResolves(pathname) {
  const stripped = pathname.split(/[?#]/)[0];
  let decoded = stripped;
  try {
    decoded = decodeURIComponent(stripped);
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
  // Rendered markup only: inline <script> bodies (JS strings are not markup)
  // — keeping <script src=...> tags so asset references are still checked —
  // and HTML comments (commented-out markup must not count) are stripped
  // before any string-based check.
  const html = raw
    .replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2")
    .replace(/<!--[\s\S]*?-->/g, "");
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  const lang = html.match(/<html[^>]*\slang=(?:"([^"]*)"|'([^']*)')/);
  if (!lang || !(lang[1] ?? lang[2]).trim()) {
    fail("missing or empty <html lang>");
  }

  const title = html.match(/<title>([^<]*)<\/title>/);
  if (!title || !title[1].trim()) fail("missing or empty <title>");

  // Either attribute order, either quote style.
  const metaContent = (name) => {
    const m =
      html.match(
        new RegExp(
          `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`,
        ),
      ) ??
      html.match(
        new RegExp(
          `<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`,
        ),
      );
    return m ? m[1] : null;
  };

  const desc = metaContent("description");
  if (desc === null || !desc.trim()) fail("missing or empty meta description");

  const viewport = metaContent("viewport");
  if (viewport === null || !viewport.trim()) {
    fail("missing or empty meta viewport");
  }

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
  for (const m of html.matchAll(/\s(?:href|src)=(?:"([^"]+)"|'([^']+)')/g)) {
    checkReference(m[1] ?? m[2], "link");
  }

  for (const m of html.matchAll(/\ssrcset=(?:"([^"]+)"|'([^']+)')/g)) {
    const value = m[1] ?? m[2];
    let skipFragment = false;
    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (skipFragment) {
        // This fragment is the payload/descriptor of a data: URI started in
        // the previous fragment (valid data: URIs always contain a comma).
        skipFragment = false;
        continue;
      }
      if (!trimmed) continue;
      if (/^data:/i.test(trimmed)) {
        // No whitespace → the payload continues into the next fragment.
        if (!/\s/.test(trimmed)) skipFragment = true;
        continue;
      }
      const token = trimmed.split(/\s+/)[0];
      if (token) checkReference(token, "srcset target");
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
