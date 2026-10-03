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
 * comments are stripped first, then inert/raw-text containers drop whole:
 * <style>/<template>/<textarea>/<noscript> for every check below, plus
 * <title> for all but its own check (RCDATA text; only the head's title
 * counts as the document title — an <svg><title> label doesn't); an
 * unclosed container is malformed markup Astro never emits — it fails
 * loudly rather than being guessed out. Every structural lookup —
 * lang/title/meta/base and the <h1> count — runs over quote-aware tag
 * fragments (extractTags): `>` inside a quoted attribute value never
 * splits a match, and markup inside another attribute's value
 * (content="<title>…", content="<body>") is content of that fragment,
 * never structure;
 * tag/attribute *names* are matched
 * case-insensitively, whitespace around `=` is tolerated, and values accept
 * quoted *and* unquoted HTML5 forms, so verbatim files copied from public/
 * are checked the same as Astro output):
 *   - non-empty <html lang> (read off the document's first <html> tag — a
 *     stray literal `<html lang=…>` in content can't rescue a bare one)
 *   - non-empty <title> (tag may carry whitespace/attributes)
 *   - meta name="description" present and non-empty (either attribute order)
 *   - meta name="viewport" present and non-empty (either attribute order)
 *   - exactly one <h1> (self-closing <h1/> counts; parsers ignore the slash —
 *     counted at fragment positions only: a value can't fake it, while a
 *     literal <h1> in TEXT still counts (parsers promote it); inert/raw-text
 *     containers are excluded, so a literal "<h1>" inside an attribute
 *     value, <template>, <textarea>, <style>, <title> or <noscript> can
 *     neither fake nor hide the count)
 * Across pages:
 *   - every internal root-relative or relative href/src/srcset reference
 *     (the href pattern also matches SVG xlink:href) — matched only at
 *     real attribute-name positions inside parsed tag fragments
 *     (quote-aware tokenizer), so neither prose/code samples nor
 *     attribute-shaped text inside quoted values (alt="use href=/x")
 *     can ever red the gate; leading/trailing whitespace trimmed
 *     (URL parsing strips it too), query/fragment stripped,
 *     percent-encoded paths and numeric HTML entities decoded, and
 *     root-relative paths get WHATWG normalization (tab/LF/CR stripped,
 *     "\" mapped to "/") — resolves to a built file (zero dead links).
 *     References still carrying an undecodable named HTML entity
 *     (&eacute; … — the full entity table would be a dependency) are
 *     skipped, never red-flagged. Relative references resolve against
 *     <base href> when the document declares one (hand-written public/ files),
 *     else the page's URL directory; the <base> tag itself is not
 *     link-checked (resolution prefix, not a fetch target), and an offsite
 *     <base> sends BOTH relative and root-relative references offsite —
 *     browsers resolve against the document's base URL — so they are not
 *     validated. Absolute URLs (scheme-bearing) are treated as external and
 *     not validated — that is what keeps canonical/OG absolute URLs from
 *     false-failing. srcset data: URIs are skipped: checking resumes only at
 *     path-prefixed tokens carrying neither quotes nor markup characters
 *     (root/dot/scheme — see looksLikeUrl), so base64/percent-encoded
 *     payloads cannot red the gate; documented residual: a RAW unencoded
 *     payload fragment that is itself a clean, quote-free path token can
 *     still resume and red — it must name a missing file to do so, and
 *     encoded payloads never contain such tokens (a bare-relative entry
 *     mixed after a data: URI is under-checked instead). CSS-internal
 *     url() references are not validated either (would require parsing
 *     stylesheets); that stays in ENG-86's manual asset checks.
 *
 * Local reproduction: npm run build && npm run check:dist
 * Regression battery: npm test (tests/check-dist.test.mjs via node:test —
 * wired into `npm run verify` and the CI job together with the route suite;
 * the suite's type-stripped .ts import needs Node >= 22.18 — the engines
 * floor, so every documented command works across the declared range).
 * Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Default to the repo's dist/; an explicit path (tests, ad-hoc runs against
// another build) is taken as-is.
const distDir = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../dist", import.meta.url));
const CHECK_ORIGIN = "http://check.dist";

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

const htmlFiles = walk(distDir).filter((f) =>
  f.toLowerCase().endsWith(".html"),
);
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

/**
 * Parse a srcset value into candidate URL tokens (WHATWG "parse a srcset
 * attribute", simplified): a URL is a non-whitespace run — so commas *inside*
 * a run belong to the filename (`/a,b.png`); a run ending in commas is a
 * comma-separated entry; descriptors follow until an entry-boundary comma.
 * `data:` payloads with spaces stay split across runs, which the caller
 * skips via the data-URI state below.
 */
function parseSrcset(value) {
  const isWs = (c) =>
    c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";
  const urls = [];
  let i = 0;
  const len = value.length;
  while (i < len) {
    while (i < len && (isWs(value[i]) || value[i] === ",")) i++;
    if (i >= len) break;
    const start = i;
    while (i < len && !isWs(value[i])) i++;
    let url = value.slice(start, i);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url) urls.push(url);
      continue;
    }
    // Consume descriptors until an entry-boundary comma or end of value.
    while (i < len) {
      if (value[i] === ",") {
        i++;
        break;
      }
      if (isWs(value[i])) {
        let j = i;
        while (j < len && isWs(value[j])) j++;
        if (j >= len || value[j] === ",") {
          i = j + (j < len ? 1 : 0);
          break;
        }
        i = j; // next descriptor token
      } else {
        while (i < len && !isWs(value[i]) && value[i] !== ",") i++;
      }
    }
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Heuristic used only while skipping a srcset `data:` URI: resume checking
 * at a token that is *path-prefixed* — root-relative, dot-relative or
 * scheme-bearing — and carries neither quote nor markup characters (`<`,
 * `>`, `'`, `"` never occur in a real unencoded srcset URL, but all litter
 * raw payload text). Payload/descriptor fragments (`10'><path`, `b.png`,
 * `/gone.png'`, `/gone.png'>`, `1x`) never qualify, so base64/percent-encoded
 * payloads cannot red the gate; documented residual: a RAW unencoded payload
 * fragment that is itself a clean path token (e.g. `, /gone.png ` inside a
 * style attribute) can still resume and red — it must name a missing file to
 * do so, and encoded payloads never contain such tokens. Failing to resume
 * only ever under-checks the rest of a value.
 */
const looksLikeUrl = (token) =>
  !/[<>'"]/.test(token) && // markup/quote fragments never resume
  (/^(?:https?:)?\/\//.test(token) || /^\.{0,2}\//.test(token));

/**
 * Extract the document's tag fragments as `{raw, start, end}` —
 * quote-aware (a `>` inside a quoted attribute value does not end the
 * tag). A tag opens at `<` followed by a
 * letter, `/`, `!` or `?` per the HTML tokenizer; any other `<` (e.g.
 * `a < b`) is text. All structural matching (references, lang/title/meta/
 * base, the <h1> count) runs over these fragments, so prose, code samples
 * and other text that merely *mentions* `href="/…"` never counts as a
 * link, and markup inside another attribute's quoted value is content of
 * that one fragment (review rounds 8–11). An unterminated tag
 * (malformed markup) is skipped rather than guessed at.
 */
function extractTags(markup) {
  const tags = [];
  const open = /<(?=[a-z!/?])/gi;
  let m;
  while ((m = open.exec(markup)) !== null) {
    let i = m.index + 1;
    let quote = null;
    while (i < markup.length) {
      const ch = markup[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      i++;
    }
    if (i >= markup.length) break;
    tags.push({
      raw: markup.slice(m.index, i + 1),
      start: m.index,
      end: i + 1,
    });
    open.lastIndex = i + 1;
  }
  return tags;
}

/**
 * Fragments of `tags` that are an open tag of `name` — tag-context only:
 * a `<title>`/`<meta>`-looking sequence inside another attribute's quoted
 * value lives inside that tag's fragment and never becomes a fragment of
 * its own (review rounds 10–11).
 */
const tagsNamed = (tags, name) => {
  const re = new RegExp(`^<${name}(?=[\\s>/])`, "i");
  return tags.filter((t) => re.test(t.raw));
};

/**
 * Parse a whole open tag (from extractTags) into attribute
 * records `{name, value}` — a quote-aware walk from after the tag name:
 * names end at whitespace/`=`/`/`/`>`, values are read through their
 * quote (or up to whitespace/`>` unquoted, same charset the reference
 * checks accepted before). Matching happens at real attribute-name
 * positions only, so attribute-shaped text inside a quoted value
 * (`alt="use href=/ghost1"`, `data-x=" lang=zz"`) is content, not
 * structure (review round 10). Boolean attributes carry
 * `value: undefined`.
 */
function tagAttributes(tag) {
  const attrs = [];
  let i = 1; // skip "<"
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
    i++; // "="
    while (i < tag.length && /\s/.test(tag[i])) i++;
    let value;
    const quote = tag[i];
    if (quote === '"' || quote === "'") {
      i++;
      const valueStart = i;
      while (i < tag.length && tag[i] !== quote) i++;
      value = tag.slice(valueStart, i);
      if (i < tag.length) i++; // closing quote
    } else {
      const valueStart = i;
      while (i < tag.length && !/[\s"'<>=`]/.test(tag[i])) i++;
      value = tag.slice(valueStart, i);
    }
    attrs.push({ name, value });
  }
  return attrs;
}

/**
 * Value of `attrName` in an open-tag string — read through the attribute
 * tokenizer, so lookalike text inside another attribute's quoted value
 * (`data-x=" lang=zz"`) can never satisfy the lookup (review round 10).
 * Undefined when the attribute is absent or boolean; `""` for an
 * explicitly empty value.
 */
const tagAttr = (tag, attrName) => {
  const attr = tagAttributes(tag).find(
    (a) => a.name.toLowerCase() === attrName,
  );
  return attr ? attr.value : undefined;
};

const failures = [];
let referencesChecked = 0;

for (const file of htmlFiles) {
  const relFile = relative(distDir, file).split(sep).join("/");
  const route = "/" + relFile.replace(/(^|\/)index\.html$/i, "$1");
  const raw = readFileSync(file, "utf8");
  // Rendered markup only: inline <script> bodies (JS strings are not markup)
  // — keeping <script src=...> tags so asset references are still checked;
  // the open tag is matched quote-aware, so `>` inside a quoted attribute
  // can't split it and orphan an unclosed quote that would swallow the rest
  // of the document during tag extraction — and HTML comments
  // (commented-out markup must not count) are stripped before any
  // string-based check.
  const html = raw
    .replace(
      /(<script(?=[\s>])(?:"[^"]*"|'[^']*'|[^>"'])*>)[\s\S]*?(<\/script>)/gi,
      "$1$2",
    )
    .replace(/<!--[\s\S]*?-->/g, "");
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  // Inert/raw-text containers drop whole bodies for every check below —
  // <template> never renders, <textarea> and <title> hold RCDATA text,
  // <style> holds CSS strings (its url() stays out of scope), and
  // <noscript> only renders when scripting is off (these checks model the
  // normal rendering). <title>'s own presence check needs the tag itself,
  // so it runs on `titleSrc` (containers minus <title>); everything else
  // uses `stripped` (all of them, <title> included).
  const titleSrc = html.replace(
    /<(style|template|textarea|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  const stripped = html.replace(
    /<(style|template|textarea|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );

  // Every structural lookup below runs over these tag fragments — never
  // raw strings — so markup inside another attribute's quoted value
  // (`content="<title>…</title>"`, `content="<body>"`) stays content of
  // that one fragment (review round 11).
  const pageTags = extractTags(stripped);

  const htmlTag = tagsNamed(pageTags, "html")[0];
  const lang = htmlTag && tagAttr(htmlTag.raw, "lang");
  if (!lang || !lang.trim()) {
    fail("missing or empty <html lang>");
  }

  // <title> is RCDATA: inner markup is literal text, so the emptiness test
  // runs on the raw content (a "Page<h1>x</h1>" title is not empty). Only
  // the head's own title counts — an <svg><title> in the body is a diagram
  // label, not the document title — and both anchors (<title>, <body>) are
  // fragment lookups, so head-attribute values carrying title- or
  // body-shaped markup can neither shadow the real title nor truncate the
  // head early (review round 11).
  const titleTags = extractTags(titleSrc);
  const bodyTag = tagsNamed(titleTags, "body")[0];
  const headEnd = bodyTag ? bodyTag.start : titleSrc.length;
  const titleTag = tagsNamed(titleTags, "title").find((t) => t.start < headEnd);
  let titleText = "";
  if (titleTag) {
    // After the open tag the RCDATA content runs to the first </title>.
    const rest = titleSrc.slice(titleTag.end);
    const close = rest.search(/<\/title\s*>/i);
    titleText = close === -1 ? "" : rest.slice(0, close);
  }
  if (!titleText.trim()) fail("missing or empty <title>");

  // Either attribute order; quoted with either style (apostrophes allowed
  // inside differently-quoted values) or unquoted HTML5 values — for BOTH
  // the name= and content= attributes, with optional whitespace around =.
  // Attributes are read off fragment <meta> tags (a fake <meta> inside a
  // quoted value or a container can't satisfy the check).
  const metaContent = (name) => {
    for (const tag of tagsNamed(pageTags, "meta")) {
      const n = tagAttr(tag.raw, "name");
      if (n !== undefined && n.toLowerCase() === name) {
        return tagAttr(tag.raw, "content") ?? null;
      }
    }
    return null;
  };

  const desc = metaContent("description");
  if (desc === null || !desc.trim()) fail("missing or empty meta description");

  const viewport = metaContent("viewport");
  if (viewport === null || !viewport.trim()) {
    fail("missing or empty meta viewport");
  }

  // Count <h1> at fragment positions only: a literal "<h1>" inside an
  // attribute value or attribute-shaped prose can't fake the count, while
  // a literal <h1> in TEXT — which parsers promote to a real heading —
  // still counts, matching DOM semantics (review round 11; replaces the
  // old whole-string value-blanking pass, which hid text-level <h1>s
  // behind prose that merely looked like `name = "…"`).
  const h1Count = pageTags.filter((t) => /^<h1[\s/>]/i.test(t.raw)).length;
  if (h1Count !== 1) fail(`expected exactly one <h1>, found ${h1Count}`);

  // Base for resolving relative references: <base href> when the document
  // declares one (verbatim public/ files), else the page's URL directory.
  // The <base> tag itself is excluded from link scanning below — it is a
  // resolution prefix, not a fetch target (the browser never requests it).
  const pageDir = posix.dirname("/" + relFile); // "/" or "/about"
  let pageBase =
    CHECK_ORIGIN + (pageDir.endsWith("/") ? pageDir : `${pageDir}/`);
  const baseTag = tagsNamed(pageTags, "base")[0];
  const baseHref = baseTag ? tagAttr(baseTag.raw, "href") : undefined;
  let baseOffsite = false;
  if (baseHref !== undefined) {
    try {
      pageBase = new URL(baseHref, pageBase).href;
      baseOffsite = new URL(pageBase).origin !== CHECK_ORIGIN;
    } catch {
      // unparsable <base href> — fall back to the page directory
    }
  }

  /** Check one raw reference (href/src value or srcset entry). */
  const checkReference = (rawTarget, kind) => {
    // Quoted attribute values may carry stray whitespace/newlines — URL
    // parsing strips it too (`href="/about "` requests /about).
    let target = rawTarget.trim();
    if (target.includes("&")) {
      const cp = (n) =>
        Number.isFinite(n) && n >= 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : "\uFFFD";
      target = target
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => cp(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => cp(Number(dec)))
        .replace(
          /&(amp|lt|gt|quot|apos);/g,
          (m, n) =>
            ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n] ?? m,
        );
      // Any other named entity (&eacute; …) needs the full HTML entity
      // table — a dependency — so skip the reference instead of
      // red-flagging a path this check cannot decode reliably.
      if (/&[a-z][a-z0-9]+;/i.test(target)) return;
    }
    if (target.startsWith("//")) return; // protocol-relative → external
    // Fragment/query-only references are same-document fetches — unless the
    // document declares <base>, which browsers resolve them against
    // (href="#x" → <base>/#x), making them checkable paths.
    if (
      (target.startsWith("#") || target.startsWith("?")) &&
      baseHref === undefined
    ) {
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // http:, mailto:, data: …
    let pathname;
    if (target.startsWith("/")) {
      // Browsers resolve root-relative references against the document's
      // base URL — an offsite <base> sends them offsite too.
      if (baseOffsite) return;
      // WHATWG normalization this raw-string branch would otherwise miss
      // (the relative branch gets it via new URL): tab/LF/CR anywhere are
      // stripped and "\" maps to "/" for special schemes.
      pathname = target.replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
    } else {
      try {
        const resolved = new URL(target, pageBase);
        // <base> pointing offsite: the browser would fetch it externally.
        if (resolved.origin !== CHECK_ORIGIN) return;
        pathname = resolved.pathname;
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
  // References are read through the attribute tokenizer (tagAttributes),
  // so only real attribute-name positions count — prose in text nodes AND
  // attribute-shaped text inside quoted values (`alt="use href=/x"`) can
  // never red the gate. <base> tags are skipped — resolution prefixes are
  // never fetch targets. xlink:href matches its exact name (colons fine).
  for (const { raw } of pageTags) {
    if (/^<base\b/i.test(raw)) continue;
    for (const { name, value } of tagAttributes(raw)) {
      if (value === undefined) continue;
      const attr = name.toLowerCase();
      if (attr === "href" || attr === "src" || attr === "xlink:href") {
        checkReference(value, "link");
      } else if (attr === "srcset") {
        let inDataUri = false;
        for (const token of parseSrcset(value)) {
          if (inDataUri) {
            if (!looksLikeUrl(token)) continue; // payload/descriptor fragment
            inDataUri = false;
          } else if (/^data:/i.test(token)) {
            inDataUri = true;
            continue;
          }
          checkReference(token, "srcset target");
        }
      }
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
