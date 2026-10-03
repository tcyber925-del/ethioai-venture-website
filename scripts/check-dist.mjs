#!/usr/bin/env node
/**
 * ENG-87 — deterministic post-build checks on dist/.
 *
 * Spec 07 "Verification contract": accessibility/static checks, deterministic
 * SEO checks and "link/assets validation where reliable". Boundary: this is
 * automated regression protection only — manual visual, responsive,
 * interaction and production-like QA stays in ENG-86 (spec 06).
 *
 * Per generated page:
 *   - <html lang> present
 *   - non-empty <title>
 *   - meta name="description" present and non-empty
 *   - meta name="viewport" present
 *   - exactly one <h1>
 * Across pages:
 *   - every internal href/src resolves to a built file (zero dead links)
 *
 * Local reproduction: npm run build && npm run check:dist
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
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

/** Does an internal URL path resolve to something a static host serves? */
function targetResolves(urlPath) {
  const clean = urlPath.split(/[?#]/)[0];
  const rel = clean.replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [join(rel, "index.html")]
    : [rel, `${rel}.html`, join(rel, "index.html")];
  return candidates.some((c) => existsSync(join(distDir, c)));
}

const failures = [];
let linksChecked = 0;

for (const file of htmlFiles) {
  const route =
    "/" +
    relative(distDir, file)
      .split(sep)
      .join("/")
      .replace(/(^|\/)index\.html$/, "$1");
  const html = readFileSync(file, "utf8");
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  if (!/<html[^>]*\slang="/.test(html)) fail("missing <html lang>");

  const title = html.match(/<title>([^<]*)<\/title>/);
  if (!title || !title[1].trim()) fail("missing or empty <title>");

  const desc =
    html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/) ??
    html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"/);
  if (!desc || !desc[1].trim()) fail("missing or empty meta description");

  if (!/<meta[^>]*name="viewport"/.test(html)) fail("missing meta viewport");

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) fail(`expected exactly one <h1>, found ${h1Count}`);

  for (const [, target] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    // External URLs, in-page anchors and mailto: are out of scope — this is
    // the deterministic internal link/assets check ("where reliable").
    if (!target.startsWith("/") || target.startsWith("//")) continue;
    linksChecked += 1;
    if (!targetResolves(target)) fail(`dead internal link: ${target}`);
  }
}

if (failures.length > 0) {
  console.error(`check:dist failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:dist passed — ${htmlFiles.length} page(s), ${linksChecked} internal link(s), 0 problems.`,
);
