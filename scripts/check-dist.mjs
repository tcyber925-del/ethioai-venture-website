#!/usr/bin/env node
/**
 * ENG-87 — deterministic post-build checks on dist/.
 *
 * Spec 07 "Verification contract": accessibility/static checks, deterministic
 * SEO checks and "link/assets validation where reliable". Boundary: this is
 * automated regression protection only — manual visual, responsive,
 * interaction and production-like QA stays in ENG-86 (spec 06).
 *
 * Per generated page (rendered markup — every drop runs over one
 * quote-aware token walk, never a raw regex over the document: text
 * inside a quoted attribute value can never open or close a strip.
 * Inline <script>/<iframe>/<object> bodies drop while the tags stay
 * (src=/data= IS a reference-checked fetch target; `<script/>` still
 * opens — HTML ignores the flag for these elements; iframe children live
 * in a child document, object children are failure-only fallback),
 * HTML comments drop whole (the abrupt `<!-->`/`<!--->` forms and `--!>`
 * close at their `>`; an unclosed `<!--` runs to EOF — all like
 * parsers), `<![CDATA[…]]>` drops to `]]>` (foreign content: a text node
 * that never fetches) while `<?…>` and non-doctype `<!…>` bogus
 * comments drop to their first `>`, then inert/raw-text/non-rendered
 * containers drop whole: <style>/<template>/<textarea>/<noscript>/
 * <xmp>/<noframes> for every check below (<plaintext> never closes — it
 * runs to EOF), plus <title> for all but its own check (RCDATA text;
 * only the head's own HTML <title> counts as the document title — an
 * <svg>/<math> <title> label never does at any source position, tracked
 * by foreign depth since an svg started in head pops to body — while an
 * in-foreign <title>'s content is scanned as markup, not raw text); an unclosed <container> is malformed markup
 * Astro never emits — it fails loudly rather than being guessed out. Every structural lookup —
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
 *     neither fake nor hide the count; an <svg>/<math> <h1> counts too —
 *     h1–h6 are breakout elements in foreign content, so the parser pops
 *     out and the heading lands as a real HTMLHeadingElement, and an SVG
 *     <title> is an HTML integration point (its content is scanned as
 *     markup, not dropped as raw text))
 * Across pages:
 *   - every internal root-relative or relative href/src/srcset reference
 *     (the href pattern also matches SVG xlink:href; <object data=…> is
 *     its element's fetch target and is checked the same, review round
 *     16) — matched only at
 *     real attribute-name positions inside parsed tag fragments
 *     (quote-aware tokenizer), so neither prose/code samples nor
 *     attribute-shaped text inside quoted values (alt="use href=/x")
 *     can ever red the gate; leading/trailing whitespace trimmed
 *     (URL parsing strips it too), query/fragment stripped,
 *     percent-encoded paths and numeric HTML entities decoded, and
 *     root-relative paths get WHATWG normalization (tab/LF/CR stripped,
 *     "\" mapped to "/") — resolves to a built file (zero dead links).
 *     References whose pathname still carries an undecodable named
 *     HTML entity (&eacute; … — the full entity table would be a
 *     dependency, and browsers decode legacy no-semicolon forms too)
 *     are skipped, never red-flagged — and only on the
 *     query/fragment-stripped path, so query text such as
 *     ?utm_source=… (discarded before any file lookup) never silences
 *     a reference (round 19). Relative references resolve against
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
 * End index (one past `>`) of the tag opening at `start` — an
 * attribute-state machine mirroring the HTML tokenizer (review round
 * 13): quote state opens only for a quote at attribute-VALUE position
 * (after `=`); quotes in tag/attribute names and inside unquoted values
 * are ordinary characters (browsers append them and end the tag at `>`),
 * so `content=it's` can never open a phantom quote that swallows the
 * rest of the document. `>` inside a quoted value does not end the tag.
 * -1 when the tag never terminates (malformed markup at EOF).
 * When `info` is passed it receives `selfClosing` — the WHATWG
 * self-closing flag for THIS tag: set only when a structurally-positioned
 * `/` sits immediately before the `>`. Whitespace between them (`<svg /
 * >`) leaves the flag unset (self-closing start tag state reconsumes and
 * never sets it), and a `/` inside an unquoted value (`title=x/`) isn't
 * structural at all — both verified against parse5, html5lib and
 * Chromium (review round 18).
 */
function tagEndFrom(markup, start, info) {
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
      // Unquoted values end at `>` or whitespace; quotes, `<`, `=` … are
      // appended (parse errors in browsers, but never quote-openers).
      if (ch === ">") {
        if (info) info.selfClosing = false; // a `/` here was value, not flag
        return i + 1;
      }
      if (/\s/.test(ch)) state = "attr";
      i++;
      continue;
    }
    // name | attr | before-value
    if (ch === ">") {
      if (info) info.selfClosing = markup[i - 1] === "/"; // flag touches `>`
      return i + 1;
    }
    if (/\s/.test(ch)) {
      if (state === "name") state = "attr";
      i++;
      continue;
    }
    if (state === "before-value") {
      if (ch === '"') state = "dq";
      else if (ch === "'") state = "sq";
      else state = "unq";
      i++;
      continue;
    }
    if (ch === "=" && state === "attr") state = "before-value";
    // any other character (incl. quotes and `=` outside attribute position)
    // is part of the tag/attribute name — state stays (name/attr)
    i++;
  }
  return -1;
}

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
    const end = tagEndFrom(markup, m.index);
    if (end === -1) break;
    tags.push({ raw: markup.slice(m.index, end), start: m.index, end });
    open.lastIndex = end;
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

/** Elements whose content is literal text (raw text / RCDATA) — self-
 * closing flags are ignored for them by HTML, so `<script/>` still opens.
 * `xmp`/`noframes` are legacy raw-text; `plaintext` never closes (runs to
 * EOF). */
const RAWTEXT_NAMES = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "noscript",
  "xmp",
  "noframes",
  "plaintext",
]);

/** Elements whose open tag carries a fetch target (src=/data=) so the tag
 * stays in the output while the body — never fetched as part of THIS
 * document (child-document content or failure-only fallback) — drops. */
const KEEP_OPEN = new Set(["script", "iframe", "object"]);

/** Lowercased tag name of a complete tag fragment — `</svg>` → "svg",
 * `<svg/>` → "svg" (the same scan `markupDropEvents`'s tagNameAt does,
 * over the fragment instead of the document). */
const fragmentName = (fragment) => {
  let s = fragment[1] === "/" ? 2 : 1;
  let e = s;
  while (e < fragment.length && !/[\s/>]/.test(fragment[e])) e++;
  return fragment.slice(s, e).toLowerCase();
};

/**
 * True when a complete start-tag fragment carries a REAL self-closing
 * flag — derived from `tagEndFrom`'s attribute state machine, never a
 * lexical `/>` regex (round 17's regex was inverted: per WHATWG,
 * whitespace after `/` DROPS the flag, and a `/` inside an unquoted
 * value isn't structural). Ground truth — parse5, html5lib and Chromium
 * all agree (review round 18):
 *   `<svg />` `<svg/>` `<svg title="x"/>` `<svg title=x />` `<svg a=b c/>` → true
 *   `<svg / >` (space after `/`), `<svg title=x/>` (value swallows it) → false
 * One derivation shared by the walk's foreign-depth tracking and the
 * title verdict, so the two can never diverge (round 18, Low 4).
 */
function isSelfClosingTag(fragment) {
  const info = {};
  const end = tagEndFrom(fragment, 0, info);
  return end === fragment.length && info.selfClosing === true;
}

/** Foreign-depth bookkeeping for one complete tag fragment: an `<svg>`/
 * `<math>` open increments (unless really self-closing), its close
 * decrements (floored at 0), anything else leaves the depth untouched —
 * THE one rule behind both the token walk and the title verdict
 * (review round 18, Low 4). */
function stepForeignDepth(fragment, depth) {
  const name = fragmentName(fragment);
  if (name !== "svg" && name !== "math") return depth;
  if (fragment[1] === "/") return depth > 0 ? depth - 1 : depth;
  return isSelfClosingTag(fragment) ? depth : depth + 1;
}

/**
 * One quote-aware forward pass over the raw page markup yielding drop
 * regions `{s, e, always?|drop}` (review round 12): the pre-processing
 * strips run over THIS walk, never raw regexes over the document — text
 * inside a quoted attribute value (`content="<template>"`) can never open
 * a false strip boundary that eats the markup up to a later real close.
 *   - comments drop whole (an unclosed `<!--` runs to EOF, like parsers);
 *   - `<![CDATA[ … ]]>` drops to `]]>` (foreign content: a text node —
 *     nothing inside ever fetches); `<?…>` and non-doctype `<!…>` are
 *     bogus comments — dropped to their first `>`;
 *   - `<script>`, `<iframe>`, `<object>` tags stay (src=/data= IS a
 *     reference-checked fetch target) but the body drops — JS is raw,
 *     iframe children live in a child document, object children are
 *     failure-only fallback (to EOF / depth-close when unclosed);
 *   - raw-text elements (`style`/`textarea`/`title`/`noscript`/`xmp`/
 *     `noframes`) drop whole to their first close (or EOF when
 *     unclosed), and `<plaintext>` drops to EOF (it never closes);
 *   - `<template>` nests: drops whole only when a matching close exists at
 *     depth 0 over real tag fragments; an unclosed one produces no region
 *     (malformed markup fails loudly — documented boundary).
 * An incomplete tag at EOF drops with the rest of the document (parsers
 * emit nothing for it).
 */
function markupDropEvents(raw) {
  const events = [];
  const len = raw.length;

  const tagNameAt = (lt, tagEnd) => {
    let s = lt + 1;
    if (raw[s] === "/") s++;
    let e = s;
    while (e < tagEnd && !/[\s/>]/.test(raw[e])) e++;
    return raw.slice(s, e).toLowerCase();
  };

  // Comment close (round 13): `<!-->` and `<!--->` end at their `>` —
  // parsers' abrupt-closing empty forms — otherwise the first `-->` or
  // `--!>` closes; -1 when genuinely unterminated (runs to EOF).
  const commentEnd = (lt) => {
    if (raw[lt + 4] === ">") return lt + 5;
    if (raw[lt + 4] === "-" && raw[lt + 5] === ">") return lt + 6;
    const re = /--!?>/g;
    re.lastIndex = lt + 4;
    const m = re.exec(raw);
    return m ? m.index + m[0].length : -1;
  };

  // Raw-text body: literal until the first `</name` (self-closing flags
  // ignored — `<script/>` still opens).
  const findRawClose = (from, name) => {
    const re = new RegExp(`</${name}(?=[\\s>/])`, "gi");
    re.lastIndex = from;
    const m = re.exec(raw);
    if (!m) return null;
    const end = tagEndFrom(raw, m.index);
    return { start: m.index, end: end === -1 ? len : end };
  };

  // Matching close of a markup container (`<template>` nests): depth over
  // real tag fragments only — raw-text bodies and comments are skipped
  // whole, so a `</template>` inside a script string or comment can't
  // close it.
  const findMarkupClose = (from, name) => {
    let depth = 1;
    let j = from;
    while (j < len) {
      const lt = raw.indexOf("<", j);
      if (lt === -1) return null;
      if (raw.startsWith("<!--", lt)) {
        const c = commentEnd(lt);
        if (c === -1) return null; // unclosed comment swallows the rest
        j = c;
        continue;
      }
      if (raw.startsWith("<![CDATA[", lt)) {
        const c = raw.indexOf("]]>", lt + 9);
        if (c === -1) return null;
        j = c + 3;
        continue;
      }
      const nxt = raw[lt + 1] ?? "";
      if (!/^[a-z!?/]/i.test(nxt)) {
        j = lt + 1;
        continue;
      }
      const tagEnd = tagEndFrom(raw, lt);
      if (tagEnd === -1) return null;
      const nm = tagNameAt(lt, tagEnd);
      if (raw[lt + 1] !== "/" && RAWTEXT_NAMES.has(nm)) {
        const close = findRawClose(tagEnd, nm);
        if (!close) return null;
        j = close.end;
        continue;
      }
      if (nm === name) {
        if (raw[lt + 1] === "/") {
          if (--depth === 0) return { start: lt, end: tagEnd };
        } else {
          depth++;
        }
      }
      j = tagEnd;
    }
    return null;
  };

  let foreignDepth = 0; // <svg>/<math> nesting — gates the <title> rule
  let i = 0;
  while (i < len) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) break;
    if (raw.startsWith("<!--", lt)) {
      const c = commentEnd(lt);
      const e = c === -1 ? len : c; // unclosed → EOF, like parsers
      events.push({ s: lt, e, always: true });
      i = e;
      continue;
    }
    const nxt = raw[lt + 1] ?? "";
    if (raw.startsWith("<![CDATA[", lt)) {
      // Foreign-content CDATA is a text node — nothing inside ever
      // fetches (review round 15). Unterminated → EOF; the HTML
      // bogus-comment `>` boundary would only leave text foreign content
      // doesn't fetch either, so this direction can only under-check.
      const c = raw.indexOf("]]>", lt + 9);
      const e = c === -1 ? len : c + 3;
      events.push({ s: lt, e, always: true });
      i = e;
      continue;
    }
    if (
      nxt === "?" ||
      (nxt === "!" && !/^<!doctype/i.test(raw.slice(lt, lt + 9)))
    ) {
      // `<?…>` (copied PHP) and non-doctype `<!…>` are bogus comments —
      // the content never parses, so drop to the first `>` (parsers end
      // bogus comments there, quotes irrelevant; review round 15).
      const gt = raw.indexOf(">", lt + 2);
      const e = gt === -1 ? len : gt + 1;
      events.push({ s: lt, e, always: true });
      i = e;
      continue;
    }
    if (!/^[a-z!?/]/i.test(nxt)) {
      i = lt + 1; // literal `<` in text (a < b)
      continue;
    }
    const tagEnd = tagEndFrom(raw, lt);
    if (tagEnd === -1) {
      events.push({ s: lt, e: len, always: true }); // EOF in tag
      break;
    }
    const name = tagNameAt(lt, tagEnd);
    const isClose = raw[lt + 1] === "/";
    if (!isClose && name === "plaintext") {
      // `<plaintext>` never closes — everything after it is text
      // (review round 15), so the drop runs to EOF.
      events.push({ s: lt, e: len, drop: name });
      i = len;
      continue;
    }
    if (!isClose && KEEP_OPEN.has(name)) {
      // The open tag stays (src=/data= IS a reference-checked fetch
      // target); the body never fetches as part of THIS document — script
      // JS is raw, iframe children live in a child document, object
      // children are failure-only fallback (review round 15).
      const close =
        name === "script"
          ? findRawClose(tagEnd, name)
          : findMarkupClose(tagEnd, name);
      events.push({ s: tagEnd, e: close ? close.start : len, always: true });
      i = close ? close.end : len;
      continue;
    }
    if (!isClose && name === "title" && foreignDepth > 0) {
      // An SVG <title> is an HTML integration point — its content is
      // markup, not RCDATA (review round 14) — so scan it like an
      // ordinary tag instead of dropping the body as raw text.
      i = tagEnd;
      continue;
    }
    if (!isClose && RAWTEXT_NAMES.has(name)) {
      const close = findRawClose(tagEnd, name);
      events.push({ s: lt, e: close ? close.end : len, drop: name });
      i = close ? close.end : len;
      continue;
    }
    if (!isClose && name === "template") {
      const close = findMarkupClose(tagEnd, name);
      if (close) events.push({ s: lt, e: close.end, drop: name });
      i = close ? close.end : tagEnd;
      continue;
    }
    // svg/math open/close tracks foreign depth for the <title> rule above
    // — one shared derivation with the title verdict, and only a REAL
    // self-closing flag suppresses the increment (round 18).
    foreignDepth = stepForeignDepth(raw.slice(lt, tagEnd), foreignDepth);
    i = tagEnd; // ordinary tag (open/close/doctype/pi)
  }
  return events;
}

/** Rebuild the markup minus the regions the token walk selected for
 * `dropTags` — regions come from the walk alone, so attribute values can
 * never open or close a strip (review round 12). */
function applyDropEvents(raw, events, dropTags) {
  const out = [];
  let pos = 0;
  for (const ev of events) {
    if (ev.always || dropTags.has(ev.drop)) {
      out.push(raw.slice(pos, ev.s));
      pos = ev.e;
    }
  }
  out.push(raw.slice(pos));
  return out.join("");
}

/** Drop sets per source: `titleSrc` keeps <title> (its presence check
 * needs the tag); `stripped` drops every inert/raw-text/non-rendered
 * container — the legacy raw-text pair (`xmp`/`noframes`) and
 * `plaintext` (never closes — EOF) included (review round 15). */
const TITLE_SRC_DROPS = new Set([
  "style",
  "template",
  "textarea",
  "noscript",
  "xmp",
  "noframes",
  "plaintext",
]);
const STRIPPED_DROPS = new Set([
  "style",
  "template",
  "textarea",
  "title",
  "noscript",
  "xmp",
  "noframes",
  "plaintext",
]);

/**
 * Parse a whole open tag (from extractTags) into attribute
 * records `{name, value}` — a quote-aware walk from after the tag name:
 * names end at whitespace/`=`/`/`/`>`, values are read through their
 * quote (or up to whitespace/`>` unquoted — WHATWG ends unquoted values
 * only there; quotes, `<`, `=`, backtick inside them are parse errors
 * browsers append, never terminators, matching tagEndFrom's `unq` state).
 * Matching happens at real attribute-name
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
      // Unquoted values end only at whitespace or the tag's `>` — quotes,
      // `<`, `=`, backtick are parse errors browsers APPEND (the same rule
      // tagEndFrom's `unq` state already applies). Truncating at them lied
      // about the target: `href=/a=b` read as `/a` red-flagged a live
      // `/a=b.html` and `href=/exists=dead` waved through when only
      // `exists.html` existed (review round 20).
      while (i < tag.length && !/[\s>]/.test(tag[i])) i++;
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
  const fail = (msg) => failures.push(`${route}: ${msg}`);

  // Rendered markup only, rebuilt by the quote-aware token walk — never
  // raw regexes over the document (review round 12: a `<template>`/
  // `<script>`/`<!--` inside a quoted attribute value can't open a false
  // strip boundary that eats live markup up to a later real close). Inline
  // <script> bodies drop (the tags stay so src= is checked; JS strings
  // are not markup), HTML comments drop whole (commented-out markup must
  // not count; unclosed → EOF, like parsers), then inert/raw-text
  // containers drop whole for every check below — <template> never
  // renders, <textarea> and <title> hold RCDATA text, <style> holds CSS
  // strings (its url() stays out of scope), and <noscript> only renders
  // when scripting is off (these checks model the normal rendering).
  // <title>'s own presence check needs the tag itself, so it runs on
  // `titleSrc` (containers minus <title>); everything else uses
  // `stripped` (all of them, <title> included).
  const dropEvents = markupDropEvents(raw);
  const titleSrc = applyDropEvents(raw, dropEvents, TITLE_SRC_DROPS);
  const stripped = applyDropEvents(raw, dropEvents, STRIPPED_DROPS);

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
  // the head's own title counts — an <svg>/<math> <title> is a diagram
  // label, not the document title — and both anchors (<title>, <body>) are
  // fragment lookups, so head-attribute values carrying title- or
  // body-shaped markup can neither shadow the real title nor truncate the
  // head early (review round 11). Depth-tracked too: an <svg>/<math>
  // started in head pops out into body at parse time, so even a
  // source-order-head foreign title (before <body>) never counts —
  // first title at foreign depth 0 wins (review round 16).
  const titleTags = extractTags(titleSrc);
  const bodyTag = tagsNamed(titleTags, "body")[0];
  const headEnd = bodyTag ? bodyTag.start : titleSrc.length;
  let titleTag;
  let foreign = 0; // <svg>/<math> open depth over fragments
  for (const t of titleTags) {
    if (t.start >= headEnd) break;
    const name = fragmentName(t.raw);
    if (name === "svg" || name === "math") {
      // Same derivation as the token walk (round 18, Low 4).
      foreign = stepForeignDepth(t.raw, foreign);
    } else if (name === "title" && t.raw[1] !== "/" && foreign === 0) {
      titleTag = t;
      break;
    }
  }
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
  // still counts, matching DOM semantics (review round 11). No namespace
  // exclusion: h1–h6 are *breakout* elements in foreign content — the
  // parser pops out of <svg>/<math> and reprocesses the token with HTML
  // rules, so an <svg><h1> lands as a real HTMLHeadingElement sibling of
  // the (emptied) svg (review round 14, reversing round 13's exclusion —
  // parse5-confirmed), and HTML integration points
  // (<foreignobject>/<desc>) parse HTML all along.
  const h1Count = pageTags.filter((t) => /^<h1[\s/>]/i.test(t.raw)).length;
  if (h1Count !== 1) fail(`expected exactly one <h1>, found ${h1Count}`);

  // Base for resolving relative references: <base href> when the document
  // declares one (verbatim public/ files), else the page's URL directory.
  // The <base> tag itself is excluded from link scanning below — it is a
  // resolution prefix, not a fetch target (the browser never requests it).
  const pageDir = posix.dirname("/" + relFile); // "/" or "/about"
  let pageBase =
    CHECK_ORIGIN + (pageDir.endsWith("/") ? pageDir : `${pageDir}/`);
  // WHATWG §2.4.3: the base URL comes from the first <base> that HAS an
  // href attribute — an href-less <base> before it is skipped (review
  // round 14); a document whose bases all lack href behaves as if none
  // was declared (baseHref stays undefined).
  const baseTag = tagsNamed(pageTags, "base").find(
    (t) => tagAttr(t.raw, "href") !== undefined,
  );
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
      // The trailing `;` is optional for every form browsers decode: legacy
      // numeric refs (`&#233`, `&#xE9`) and legacy named refs (`&amp`) are
      // consumed without it (review round 13); the five name→char mappings
      // stay exact, and `;?` never lets a name followed by `=` or an
      // alphanumeric be consumed (browsers keep those literal — `&session=x`).
      target = target
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => cp(parseInt(hex, 16)))
        .replace(/&#(\d+);?/g, (_, dec) => cp(Number(dec)))
        .replace(
          /&(amp|lt|gt|quot|apos);/g,
          (m, n) =>
            ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n] ?? m,
        )
        .replace(
          /&(amp|lt|gt|quot|apos)(?![a-z0-9=])/g,
          (m, n) =>
            ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n] ?? m,
        );
      // Any other named entity (&eacute; …) needs the full HTML entity table
      // — a dependency — so a reference whose PATHNAME still carries
      // entity-shaped text (with or without the trailing `;`: browsers decode
      // legacy no-semicolon forms when the name isn't followed by `=` or
      // alphanumerics) is skipped instead of red-flagging a path this check
      // cannot decode reliably. The test runs on the query/fragment-stripped
      // path only: query text never reaches the filesystem (targetResolves
      // discards it), so `?a=1&utm_source=x` — `&utm_source` is no entity —
      // must not silence the whole reference (review round 19: every
      // utm_*-tagged campaign URL used to escape the gate).
      if (/&[a-z][a-z0-9]+;?(?![a-z0-9=])/i.test(target.split(/[?#]/)[0]))
        return;
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
  // Non-src/href fetch attributes (poster=, form action=, formaction=) are
  // deliberately outside the checked set — a documented under-check that
  // can never red: no <form>/<video> exists in the site today, and scanning
  // them would add false-red classes (empty action = self-submit, action
  // URLs carrying query templates) nothing here exercises (review round 17).
  for (const { raw } of pageTags) {
    if (/^<base\b/i.test(raw)) continue;
    // Duplicate attributes: the parser reports a parse error and keeps the
    // FIRST — a later href/src/srcset is never fetched, so checking it
    // would false-red valid markup (review round 16).
    const seen = new Set();
    const isObject = /^<object\b/i.test(raw);
    for (const { name, value } of tagAttributes(raw)) {
      const attr = name.toLowerCase();
      if (seen.has(attr)) continue;
      seen.add(attr);
      if (value === undefined) continue;
      if (
        attr === "href" ||
        attr === "src" ||
        attr === "xlink:href" ||
        (isObject && attr === "data") // <object>'s fetch target (round 16)
      ) {
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
