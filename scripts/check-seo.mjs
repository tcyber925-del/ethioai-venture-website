#!/usr/bin/env node
/**
 * ENG-84 — deterministic head/SEO contract checks on dist/.
 *
 * check:dist (ENG-87) owns markup/accessibility/link checks and documents
 * scheme-bearing URLs (canonical, og:url) as deliberately unvalidated; this
 * script owns exactly the claims that gap leaves unprotected. Contract, per
 * built HTML page:
 *
 *   - a non-empty <title> and meta description, each UNIQUE across all
 *     built pages (emptiness is re-checked here so uniqueness never
 *     silently compares missing values);
 *   - `noindex` is present if and only if the page is the 404 error page
 *     (dist/404.html) — nothing else may opt out of the index;
 *   - non-noindex pages carry exactly one rel=canonical whose href equals
 *     site.url + the page's emitted path (index.html → "/", dir/index.html
 *     → "/dir/", flat file.html → "/file" — Cloudflare's
 *     `auto-trailing-slash` forms), plus an og:url under site.url;
 *   - noindex pages carry NO rel=canonical and NO og:url (a non-indexable
 *     error page declares no canonical target — see BaseLayout);
 *   - at least one application/ld+json block, each JSON.parse-able.
 *
 * Across artifacts:
 *
 *   - every <loc> in dist/sitemap.xml sits under site.url and resolves to
 *     a built file in dist/ (sitemap static routes are gated through
 *     routeExists at generation, so this holds in either merge order);
 *   - dist/robots.txt exists and references `Sitemap: <site.url>/sitemap.xml`.
 *
 * Site-URL facts come from src/config/site.ts — the single constant the
 * pages, sitemap and robots.txt all derive from.
 *
 * Structural lookups run over quote-aware tag fragments (a `>` inside a
 * quoted attribute value never splits a match), so a description or title
 * legitimately containing markup characters cannot fake or hide a check.
 *
 * Local reproduction: npm run build && node scripts/check-seo.mjs
 * Wired into `npm run verify` after build/check:dist (CI runs the same
 * chain through the verify entry point's steps where applicable).
 * Exits non-zero on any problem.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../src/config/site.ts";

// Default to the repo's dist/; an explicit path (ad-hoc runs) is taken as-is.
const distDir = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../dist", import.meta.url));

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
    "check:seo failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

const htmlFiles = walk(distDir).filter((f) =>
  f.toLowerCase().endsWith(".html"),
);
if (htmlFiles.length === 0) {
  console.error("check:seo failed — no HTML files in dist/.");
  process.exit(1);
}

/**
 * End index (one past `>`) of the tag opening at `start` — quote-aware
 * attribute walk mirroring the HTML tokenizer: quote state opens only at
 * attribute-VALUE position, `>` inside a quoted value does not end the tag,
 * unquoted values end at whitespace or `>` (parse errors browsers append,
 * never terminators). -1 when the tag never terminates.
 */
function tagEndFrom(markup, start) {
  let i = start + 1;
  let state = "name"; // name | attr | before-value | dq | sq | unq
  while (i < markup.length) {
    const ch = markup[i];
    if (state === "dq") {
      if (ch === '"') state = "attr";
      i++;
      continue;
    }
    if (state === "sq") {
      if (ch === "'") state = "attr";
      i++;
      continue;
    }
    if (state === "unq") {
      if (ch === ">") return i + 1;
      if (/\s/.test(ch)) state = "attr";
      i++;
      continue;
    }
    if (ch === ">") return i + 1;
    if (/\s/.test(ch)) {
      if (state === "name") state = "attr";
      i++;
      continue;
    }
    if (state === "before-value") {
      state = ch === '"' ? "dq" : ch === "'" ? "sq" : "unq";
      i++;
      continue;
    }
    if (ch === "=" && state === "attr") state = "before-value";
    i++;
  }
  return -1;
}

/**
 * Complete tag fragments as `{raw, start, end}` — quote-aware, so
 * markup-shaped text inside a quoted value is content of that one
 * fragment, never structure of its own.
 */
function extractTags(markup) {
  const tags = [];
  const open = /<(?=[a-z!/?])/gi;
  let m;
  while ((m = open.exec(markup)) !== null) {
    const end = tagEndFrom(markup, m.index);
    if (end === -1) break;
    tags.push({ raw: markup.slice(m.index, end), start: m.index, end });
    open.lastIndex = end;
  }
  return tags;
}

/** Attribute records of one open tag — same tokenizer states as above. */
function attrsOf(tag) {
  const attrs = [];
  let i = 1;
  while (i < tag.length && !/[\s/>]/.test(tag[i])) i++; // tag name
  while (i < tag.length - 1) {
    while (i < tag.length && /\s/.test(tag[i])) i++;
    if (i >= tag.length || tag[i] === ">" || tag[i] === "/") break;
    const nameStart = i;
    while (i < tag.length && !/[\s=/>]/.test(tag[i])) i++;
    const name = tag.slice(nameStart, i);
    while (i < tag.length && /\s/.test(tag[i])) i++;
    if (tag[i] !== "=") {
      attrs.push({ name, value: undefined });
      continue;
    }
    i++;
    while (i < tag.length && /\s/.test(tag[i])) i++;
    const quote = tag[i];
    let value;
    if (quote === '"' || quote === "'") {
      i++;
      const valueStart = i;
      while (i < tag.length && tag[i] !== quote) i++;
      value = tag.slice(valueStart, i);
      if (i < tag.length) i++;
    } else {
      const valueStart = i;
      while (i < tag.length && !/[\s>]/.test(tag[i])) i++;
      value = tag.slice(valueStart, i);
    }
    attrs.push({ name, value });
  }
  return attrs;
}

/** Value of `attrName` in an open tag (undefined when absent). */
function tagAttr(tag, attrName) {
  const found = attrsOf(tag).find(
    (a) => a.name.toLowerCase() === attrName.toLowerCase(),
  );
  return found ? found.value : undefined;
}

/** First open tag of `name` in a fragment list (undefined when none). */
const firstTagNamed = (tags, name) =>
  tags.find((t) => new RegExp(`^<${name}(?=[\\s>/])`, "i").test(t.raw));

/**
 * The path a dist file is served at under Cloudflare's
 * `auto-trailing-slash`: directory indexes with a trailing slash, flat
 * `.html` files without, root as "/".
 */
function emittedPath(relFile) {
  if (relFile === "index.html") return "/";
  if (relFile.endsWith("/index.html"))
    return `/${relFile.slice(0, -"index.html".length)}`;
  return `/${relFile.replace(/\.html$/i, "")}`;
}

/** Does a normalized sitemap pathname resolve to a built file? */
function sitemapTargetResolves(pathname) {
  const norm = posix.normalize("/" + pathname.replace(/^\/+/, ""));
  const rel = norm.slice(1);
  const candidates = norm.endsWith("/")
    ? [join(rel, "index.html")]
    : [rel, `${rel}.html`, join(rel, "index.html")];
  return candidates.some((c) => isFile(join(distDir, c)));
}

const failures = [];
let sitemapUrlCount = 0;
const seenTitles = new Map();
const seenDescriptions = new Map();

for (const file of htmlFiles) {
  const relFile = relative(distDir, file).split(sep).join("/");
  const route = "/" + relFile.replace(/(^|\/)index\.html$/i, "$1");
  const raw = readFileSync(file, "utf8");
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  const tags = extractTags(raw);

  // --- <title> and meta description: present, non-empty, unique --------
  const titleTag = firstTagNamed(tags, "title");
  let title = "";
  if (titleTag) {
    const rest = raw.slice(titleTag.end);
    const close = rest.search(/<\/title\s*>/i);
    title = close === -1 ? "" : rest.slice(0, close);
  }
  if (!title.trim()) fail("missing or empty <title>");
  else if (seenTitles.has(title))
    fail(`duplicate <title> (also on ${seenTitles.get(title)})`);
  else seenTitles.set(title, route);

  let description;
  for (const t of tags) {
    if (!/^<meta(?=[\s>])/i.test(t.raw)) continue;
    if ((tagAttr(t.raw, "name") ?? "").toLowerCase() === "description") {
      description = tagAttr(t.raw, "content");
      break;
    }
  }
  if (description === undefined || !description.trim())
    fail("missing or empty meta description");
  else if (seenDescriptions.has(description))
    fail(
      `duplicate meta description (also on ${seenDescriptions.get(description)})`,
    );
  else seenDescriptions.set(description, route);

  // --- noindex iff the 404 page ----------------------------------------
  let noindex = false;
  for (const t of tags) {
    if (!/^<meta(?=[\s>])/i.test(t.raw)) continue;
    if ((tagAttr(t.raw, "name") ?? "").toLowerCase() !== "robots") continue;
    const tokens = (tagAttr(t.raw, "content") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase());
    if (tokens.includes("noindex")) noindex = true;
  }
  const is404 = relFile === "404.html";
  if (noindex && !is404) fail("noindex on a page that is not the 404 page");
  if (!noindex && is404) fail("404 page is missing noindex");

  // --- canonical / og:url ----------------------------------------------
  const canonicals = tags.filter((t) => {
    if (!/^<link(?=[\s>])/i.test(t.raw)) return false;
    const rel = (tagAttr(t.raw, "rel") ?? "").toLowerCase().split(/\s+/);
    return rel.includes("canonical");
  });
  const ogUrlTag = tags.find(
    (t) =>
      /^<meta(?=[\s>])/i.test(t.raw) &&
      (tagAttr(t.raw, "property") ?? "").toLowerCase() === "og:url",
  );

  if (noindex) {
    if (canonicals.length > 0)
      fail("noindex page must not declare rel=canonical");
    if (ogUrlTag) fail("noindex page must not declare og:url");
  } else {
    if (canonicals.length !== 1) {
      fail(`expected exactly one rel=canonical, found ${canonicals.length}`);
    } else {
      const expected = `${site.url}${emittedPath(relFile)}`;
      const href = tagAttr(canonicals[0].raw, "href");
      if (href !== expected)
        fail(`canonical ${href} ≠ emitted path ${expected}`);
    }
    if (!ogUrlTag) fail("missing og:url");
    else {
      const ogUrl = tagAttr(ogUrlTag.raw, "content") ?? "";
      if (!ogUrl.startsWith(`${site.url}/`))
        fail(`og:url ${ogUrl} not under site base ${site.url}/`);
    }
  }

  // --- JSON-LD: present, parses as JSON ---------------------------------
  const ldBlocks = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (!/^<script(?=[\s>])/i.test(t.raw)) continue;
    if ((tagAttr(t.raw, "type") ?? "").toLowerCase() !== "application/ld+json")
      continue;
    const rest = raw.slice(t.end);
    const close = rest.search(/<\/script\s*>/i);
    if (close === -1) {
      fail("unterminated application/ld+json block");
      continue;
    }
    ldBlocks.push(rest.slice(0, close));
  }
  if (ldBlocks.length === 0) fail("missing application/ld+json block");
  for (const block of ldBlocks) {
    try {
      JSON.parse(block);
    } catch (error) {
      fail(`JSON-LD does not parse: ${error.message}`);
    }
  }
}

// --- robots.txt references the sitemap ---------------------------------
const robotsPath = join(distDir, "robots.txt");
if (!isFile(robotsPath)) {
  failures.push("robots.txt: missing from dist/");
} else {
  const robots = readFileSync(robotsPath, "utf8");
  const expectedLine = `Sitemap: ${site.url}/sitemap.xml`;
  if (!robots.split(/\r?\n/).some((line) => line.trim() === expectedLine))
    failures.push(`robots.txt: missing "${expectedLine}"`);
}

// --- sitemap.xml: every <loc> under the site base and built -------------
const sitemapPath = join(distDir, "sitemap.xml");
if (!isFile(sitemapPath)) {
  failures.push("sitemap.xml: missing from dist/");
} else {
  const sitemap = readFileSync(sitemapPath, "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) failures.push("sitemap.xml: no <loc> entries");
  for (const loc of locs) {
    sitemapUrlCount += 1;
    if (!loc.startsWith(`${site.url}/`)) {
      failures.push(`sitemap.xml: <loc> ${loc} not under ${site.url}/`);
      continue;
    }
    const path = loc.slice(site.url.length);
    if (!sitemapTargetResolves(path))
      failures.push(`sitemap.xml: dead <loc> ${loc}`);
  }
}

if (failures.length > 0) {
  console.error(`check:seo failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `check:seo passed — ${htmlFiles.length} page(s), ${sitemapUrlCount} sitemap URL(s), 0 problems.`,
);
