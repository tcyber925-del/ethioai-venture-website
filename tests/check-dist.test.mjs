/**
 * Regression battery for scripts/check-dist.mjs (ENG-87).
 *
 * Run: node --test  — wired into `npm run verify` and the CI job.
 *
 * Every case encodes a verdict proven in PR #12's review rounds (1–18):
 * quoted/unquoted/whitespace attribute forms, quote-aware tag-fragment
 * lookups, token-walk-only script/iframe/object/comment/CDATA/bogus-comment/
 * inert-container stripping (attribute values can never open a strip),
 * non-rendered content never link-scanned (plaintext/xmp/noframes run or drop
 * whole), duplicate-attribute first-wins (browsers never fetch the second),
 * <object data=> as its element's fetch target, foreign-depth title verdicts
 * with state-machine self-closing (whitespace- and value-aware),
 * tag-context-only link
 * scanning (prose mentioning href="/…"
 * must not count), percent/entity decoding, WHATWG path normalization,
 * <base> resolution (relative, offsite, fragment-under-base), data:-srcset
 * skipping (base64 and raw payloads), external/same-document skips, and the
 * uppercase-.HTML page sweep. Keep in sync with the script's header, which
 * documents each behavior.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "check-dist.mjs");

const PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Page</title><meta name="description" content="d">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "</head><body><h1>Page</h1></body></html>";

const SUB_PAGE =
  '<html lang="en"><head><meta charset="utf-8"><title>s</title>' +
  '<meta name="description" content="d">' +
  '<meta name="viewport" content="width=device-width"></head>' +
  "<body><h1>s</h1></body></html>";

let base; // temp dir holding one dist/ per test
const dist = () => join(base, "dist");

before(() => {
  base = mkdtempSync(join(tmpdir(), "check-dist-"));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * Run one scenario: fresh dist/ with the persistent fixture files, the
 * given index.html, plus any extra files (`path -> content`), then assert
 * the script's exit status.
 */
const run = (html, files = {}) => {
  rmSync(dist(), { recursive: true, force: true });
  mkdirSync(dist(), { recursive: true });
  writeFileSync(join(dist(), "index.html"), html);
  const persistent = [
    "ok.png",
    "_ok.png",
    "real.png",
    "a,b.png",
    "x.png",
    "ok",
  ];
  for (const name of persistent) writeFileSync(join(dist(), name), "x");
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist(), rel)), { recursive: true });
    writeFileSync(join(dist(), rel), content);
  }
  const r = spawnSync(process.execPath, [script, dist()], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout + r.stderr).trim() };
};

/** One verdict test; `html` is the full index.html for the scenario. */
const t = (name, html, want, files = {}) =>
  test(name, () => {
    const { status, out } = run(html, files);
    assert.equal(status, want, out);
  });

const inBody = (snippet) => PAGE.replace("</body>", `${snippet}</body>`);

// ── Rounds 1–4: basics, attribute forms, srcset parsing ────────────────────
t("clean page passes", PAGE, 0);
t("empty lang fails", PAGE.replace('lang="en"', 'lang=""'), 1);
t(
  "h1 inside inline script ignored",
  inBody("<script>const x='<h1>fake</h1>';</script>"),
  0,
);
t("missing script src fails", inBody('<script src="/missing.js"></script>'), 1);
t(
  "empty viewport fails",
  PAGE.replace("width=device-width, initial-scale=1", ""),
  1,
);
t(
  "commented-out dead link ignored",
  inBody('<!-- <a href="/commented-gone/">x</a> -->'),
  0,
);
t("fragment to missing target fails", inBody('<a href="/nope#x">x</a>'), 1);
t("unquoted dead href fails", inBody("<a href=/no-such-page>x</a>"), 1);
t(
  "base64 srcset dead target fails",
  inBody(
    '<img src="/ok.png" srcset="data:image/gif;base64,AAAA 1x, /nope.png 2x" alt="">',
  ),
  1,
);
t(
  "base64 srcset live target passes",
  inBody(
    '<img src="/ok.png" srcset="data:image/gif;base64,AAAA 1x, /ok.png 2x" alt="">',
  ),
  0,
);
t(
  "raw svg payload live resume passes",
  inBody(
    '<img src="/ok.png" srcset="data:image/svg+xml;utf8,<svg viewBox=\'0 0 10,10\'><path d=\'M0,0 L10,10\'/></svg> 1x, /ok.png 2x" alt="">',
  ),
  0,
);
t(
  "raw svg payload dead resume fails",
  inBody(
    '<img src="/ok.png" srcset="data:image/svg+xml;utf8,<svg viewBox=\'0 0 10,10\'><path d=\'M0,0 L10,10\'/></svg> 1x, /nope.png 2x" alt="">',
  ),
  1,
);
t(
  "comma filename live passes",
  inBody('<img src="/ok.png" srcset="/a,b.png 1x" alt="">'),
  0,
);
t(
  "comma filename dead fails",
  inBody('<img src="/ok.png" srcset="/x,y.png 1x" alt="">'),
  1,
);
t(
  "data:text payload passes",
  inBody(
    '<img src="/ok.png" srcset="data:text/plain,foo.png is text 1x, /real.png 2x" alt="">',
  ),
  0,
);
t(
  "apostrophe inside differently-quoted description passes",
  PAGE.replace('content="d"', 'content="\'Tis an apostrophe start"'),
  0,
);
t(
  "uppercase tags/attrs pass",
  PAGE.replace('<html lang="en"', '<HTML LANG="en"')
    .replace("<title>", "<TITLE>")
    .replace("</title>", "</TITLE>")
    .replace('<meta name="description"', '<META NAME="description"')
    .replace('<meta name="viewport"', '<META NAME="viewport"')
    .replace("<h1>", "<H1>")
    .replace("</h1>", "</H1>"),
  0,
);
t(
  "unquoted name=description passes",
  PAGE.replace('name="description"', "name=description"),
  0,
);
t(
  "content-before-name order passes",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<meta content="d" name="description">',
  ),
  0,
);
t(
  "whitespace around = passes",
  PAGE.replace(
    'name="description" content="d"',
    'name ="description" content ="d"',
  ).replace(
    'name="viewport" content="width',
    'name ="viewport" content ="width',
  ),
  0,
);
t("spaced dead href fails", inBody('<a href ="/no-such-page">x</a>'), 1);
t("spaced dead srcset fails", inBody('<img srcset ="/nope.png 1x" alt="">'), 1);
t("spaced live href passes", inBody('<a href ="/ok.png">x</a>'), 0);
t(
  "self-closing h1 counts as the h1",
  PAGE.replace("<h1>Page</h1>", "<h1/>"),
  0,
);

// ── Round 5: <base> resolution, payload boundary tokens ────────────────────
t(
  "<base> moves relative resolution",
  inBody('<base href="/sub/"><a href="y.png">x</a>'),
  0,
  { "sub/index.html": SUB_PAGE, "sub/y.png": "x" },
);
t(
  "<base> pointing at a missing dir fails",
  inBody('<base href="/missingdir/"><img src="x.png" alt="">'),
  1,
);
t(
  "payload word.ext fragment never resumes",
  inBody(
    '<img src="/ok.png" srcset="data:image/svg+xml,<svg a,b.png 1x, /ok.png 2x" alt="">',
  ),
  0,
);
t(
  "bare-relative entry after data: is skipped",
  inBody(
    '<img src="/ok.png" srcset="data:image/gif;base64,AAAA 1x, nope.png 2x" alt="">',
  ),
  0,
);

// ── Round 6: trimming, entities, inert h1, offsite base ────────────────────
t("trailing-space live href passes", inBody('<a href="/ ">x</a>'), 0);
t("trailing-space dead href fails", inBody('<a href="/nope ">x</a>'), 1);
t("numeric entity decodes to live path", inBody('<a href="/&#111;k">x</a>'), 0);
t(
  "undecodable named entity skipped",
  inBody('<a href="/nonexistent&eacute;thing">x</a>'),
  0,
);
t(
  "payload style= fragment never resumes",
  inBody(
    '<img src="/ok.png" srcset="data:image/svg+xml,<svg style=\'a, /gone.png\'> 1x, /ok.png 2x" alt="">',
  ),
  0,
);
t(
  "fake h1 inside attribute value ignored",
  inBody('<div title="<h1>fake</h1>"></div>'),
  0,
);
t(
  "offsite base sends root-relative refs offsite",
  inBody('<base href="https://cdn.example/"><a href="/local-gone/">x</a>'),
  0,
);

// ── Round 7: quote-suffix payloads, xlink:href, fragments under <base> ─────
t(
  "quote-suffix payload token never resumes (review repro)",
  inBody(
    '<img src="/_ok.png" srcset="data:image/svg+xml,<svg style=\'a, /gone.png\' > 1x, /_ok.png 2x" alt="">',
  ),
  0,
);
t(
  "xlink:href dead target fails",
  inBody('<svg><image xlink:href="/nope-xlink.png"></image></svg>'),
  1,
);
t(
  "xlink:href live target passes",
  inBody('<svg><image xlink:href="/ok.png"></image></svg>'),
  0,
);
t(
  "fragment under <base> resolves against it (missing base dir fails)",
  inBody('<base href="/sub/"><a href="#team">x</a>'),
  1,
);
t(
  "fragment under root <base> passes",
  inBody('<base href="/"><a href="#team">x</a>'),
  0,
);
t(
  "fragment without <base> is same-document (skipped)",
  inBody('<a href="#team">x</a>'),
  0,
);
t(
  "documented residual: clean quote-free payload path token can red",
  inBody(
    '<img src="/ok.png" srcset="data:image/svg+xml,<svg style=\'a, /gone.png x\'> 1x, /ok.png 2x" alt="">',
  ),
  1,
);

// ── Round 8: tag-context scanning, inert containers, path normalization ────
t(
  "prose mentioning href= is not a link",
  inBody('<p>Set the href="/ghost-page" attribute to link.</p>'),
  0,
);
t(
  "code sample text mentioning src= is not a link",
  inBody('<p><code>use src="/static/logo.png"</code></p>'),
  0,
);
t(
  "style-string href= is not a link",
  inBody('<style>.a{content:" href=/ghost-in-style"}</style>'),
  0,
);
t(
  "template inner markup is inert",
  inBody('<template><a href="/ghost-tpl/">x</a></template>'),
  0,
);
t(
  "h1 inside template does not count",
  inBody("<template><h1>Fake</h1></template>"),
  0,
);
t(
  "h1 inside textarea does not count",
  inBody("<textarea><h1>x</h1></textarea>"),
  0,
);
t(
  "h1 inside style string does not count",
  inBody('<style>.x{content:"<h1>y</h1>"}</style>'),
  0,
);
t(
  "h1 inside title does not count",
  PAGE.replace("<title>Page</title>", "<title>Page<h1>in title</h1></title>"),
  0,
);
t(
  "interior newline in root path normalizes",
  inBody('<a href="/ab\ncd">x</a>'),
  0,
  { abcd: "x" },
);
t(
  "backslash in root path maps to slash",
  inBody('<a href="/sub\\y.png">x</a>'),
  0,
  { "sub/y.png": "x" },
);
t("uppercase .HTML page is checked (not exempt)", PAGE, 1, {
  "LEGACY.HTML": "<html><head><title>legacy</title></head><body></body></html>",
});

// ── Round 9: quote-aware open-tag matchers, container scoping, <noscript> ─
t(
  "quote > inside html attr doesn't hide lang",
  PAGE.replace('<html lang="en">', '<html data-x="a>b" lang="en">'),
  0,
);
t(
  "quote > inside html attr with lang absent fails",
  PAGE.replace('<html lang="en">', '<html data-x="a>b">'),
  1,
);
t(
  "literal <html lang> in content can't rescue bare html",
  PAGE.replace('<html lang="en">', '<html><p><html lang="en">'),
  1,
);
t(
  "quote > inside meta attr doesn't hide description",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<meta data-x="a>b" name="description" content="d">',
  ),
  0,
);
t(
  "empty description behind quote > fails",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<meta data-x="a>b" name="description" content="">',
  ),
  1,
);
t(
  "content-before-name behind quote > passes",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<meta data-x="a>b" content="d" name="description">',
  ),
  0,
);
t(
  "quote > inside base attr still detected",
  inBody('<base data-x="a>b" href="/sub/"><a href="y.png">x</a>'),
  0,
  { "sub/index.html": SUB_PAGE, "sub/y.png": "x" },
);
t(
  "empty title behind quote > fails",
  PAGE.replace("<title>Page</title>", '<title data-x="a>b"></title>'),
  1,
);
t(
  "non-empty title behind quote > passes",
  PAGE.replace("<title>Page</title>", '<title data-x="a>b">Page</title>'),
  0,
);
t(
  "fake empty title inside <style> doesn't count",
  PAGE.replace(
    "<title>Page</title>",
    '<style>.x{content:"<title></title>"}</style><title>Page</title>',
  ),
  0,
);
t(
  "fake empty meta inside <template> doesn't count",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<template><meta name="description" content=""></template>' +
      '<meta name="description" content="d">',
  ),
  0,
);
t(
  "svg <title> in body can't rescue missing document title",
  PAGE.replace("<title>Page</title>", "").replace(
    "<h1>Page</h1>",
    "<h1>Page</h1><svg><title>diagram</title></svg>",
  ),
  1,
);
t(
  "h1 inside <noscript> doesn't count",
  inBody("<noscript><h1>NS</h1></noscript>"),
  0,
);
t(
  "dead link only inside <noscript> ignored",
  inBody('<noscript><a href="/nope-ns/">x</a></noscript>'),
  0,
);
t(
  "description only inside <noscript> fails",
  PAGE.replace(
    '<meta name="description" content="d">',
    '<noscript><meta name="description" content="d"></noscript>',
  ),
  1,
);
t(
  "quote > in script open tag doesn't disable later scanning",
  inBody('<script data-x="a>b">let x = 1;</script><a href="/nope-after">x</a>'),
  1,
);

// ── Round 10: attribute-name positions only, tokenizer lookups ─────────────
t(
  "attribute-shaped href inside alt value is not a link",
  inBody('<img alt="use href=/ghost1" src="/ok.png" width="1" height="1">'),
  0,
);
t(
  "attribute-shaped href inside content value is not a link",
  PAGE.replace('content="d"', 'content="see href=/ghost3"'),
  0,
);
t(
  "attribute-shaped href inside data value is not a link",
  inBody('<div data-x=" href=/ghost5 "></div>'),
  0,
);
t(
  "attribute-shaped srcset inside alt value is not a srcset",
  inBody(
    '<img alt="a srcset=/ghost2.png 1x" src="/ok.png" width="1" height="1">',
  ),
  0,
);
t(
  "lookalike lang=zz inside html attr value can't rescue missing lang",
  PAGE.replace('<html lang="en">', '<html data-x=" lang=zz">'),
  1,
);
t(
  "namespaced attr value with h1 doesn't inflate the count",
  PAGE.replace(
    "<h1>Page</h1>",
    '<h1>Page</h1><div xml:lang="<h1>x</h1>"></div>',
  ),
  0,
);
t(
  "namespaced dead reference still reds (count fixed, link genuinely dead)",
  inBody('<svg><image xlink:href="<h1>x</h1>"></image></svg>'),
  1,
);
t(
  "unclosed container fails loudly (malformed, documented boundary)",
  inBody("<template><h1>fake</h1>"),
  1,
);

// ── Round 11: title anchors and h1 count come from tag fragments only ──────
t(
  "title-shaped markup inside head attr value can't shadow the real title",
  PAGE.replace(
    "<title>Page</title>",
    '<meta name="x" content="<title></title>"><title>Page</title>',
  ),
  0,
);
t(
  "body-shaped markup inside head attr value can't truncate the head",
  PAGE.replace(
    "<title>Page</title>",
    '<meta name="x" content="<body>"><title>Page</title>',
  ),
  0,
);
t(
  "title-shaped markup inside attr value can't fake a missing title",
  PAGE.replace(
    "<title>Page</title>",
    '<meta name="x" content="<title>Fake</title>">',
  ),
  1,
);
t(
  'text-level h1 behind prose shaped like name = "..." still counts',
  PAGE.replace(
    "<h1>Page</h1>",
    '<p>write tag = "<h1>heading</h1>" literally</p>',
  ),
  0,
);
t(
  "text-level second h1 isn't masked by prose-shaped blanking",
  inBody('<p>kw = "<h1>second</h1>"</p>'),
  1,
);

// ── Round 12: the strip passes themselves are token-walk scoped ────────────
t(
  "template-shaped text in attr value can't open a strip (false red)",
  PAGE.replace(
    "<title>Page</title>",
    '<title>Page</title><meta name="x" content="<template>">',
  ).replace("</body>", "<template><p>t</p></template></body>"),
  0,
);
t(
  "template-shaped text in attr value can't eat a live dead link",
  inBody(
    '<div data-x="<template>"></div><a href="/nope-eaten">x</a>' +
      "<template><p>t</p></template>",
  ),
  1,
);
t(
  "comment-shaped text in attr value can't eat a live dead link",
  inBody('<div data-x="<!--"></div><a href="/nope-c">x</a><!-- real -->'),
  1,
);
t(
  "script-shaped text in attr value can't eat a live dead link",
  inBody(
    '<div data-x="<script>"></div><a href="/nope-s">x</a>' +
      "<script>var y;</script>",
  ),
  1,
);
t(
  "unclosed comment runs to EOF (like parsers)",
  inBody('<!-- <a href="/gone/">x</a>'),
  0,
);
t(
  "self-closing <script/> still opens (raw body dropped)",
  inBody("<script/>const x='<h1>fake</h1>';</script>"),
  0,
);

// ── Rounds 13–14: tokenizer-state quote tracking, comment closes, entities,
//    breakout headings, integration-point titles, base selection ───────────
t(
  "unquoted value with apostrophe can't open a phantom quote (desc meta)",
  PAGE.replace('content="d"', "content=it's"),
  0,
);
t(
  "unquoted value with apostrophe keeps later h1 outside the tag",
  PAGE.replace("<h1>Page</h1>", "<img alt=don't><h1>Page</h1>"),
  0,
);
t(
  "phantom quote with no later quote still scans the dead link",
  "<!doctype html><html lang=en><head><meta charset=utf-8>" +
    "<title>P</title><meta name=description content=d>" +
    "<meta name=viewport content=width></head>" +
    "<body><h1>P</h1><img alt=don't><a href=/dead-after>x</a></body></html>",
  1,
);
t(
  "named entity without semicolon is skipped, not red-flagged",
  inBody('<a href="/caf&eacute">x</a>'),
  0,
  { "café/index.html": SUB_PAGE },
);
t(
  "numeric entity without semicolon decodes to the real path",
  inBody('<a href="/caf&#233">x</a>'),
  0,
  { "café/index.html": SUB_PAGE },
);
t(
  "abrupt <!--> comment closes at its > (h1 still counts)",
  PAGE.replace("<h1>Page</h1>", "<!--><h1>Page</h1>"),
  0,
);
t(
  "abrupt <!---> comment closes at its > (h1 still counts)",
  PAGE.replace("<h1>Page</h1>", "<!---><h1>Page</h1>"),
  0,
);
t(
  "svg h1 breaks out of foreign content and counts (two real h1s)",
  inBody("<svg><h1>x</h1></svg>"),
  1,
);
t(
  "math h1 breaks out of foreign content and counts (two real h1s)",
  inBody("<math><h1>x</h1></math>"),
  1,
);
t(
  "page whose only heading is an svg h1 passes (breakout → one real h1)",
  PAGE.replace("<h1>Page</h1>", "<svg><h1>x</h1></svg>"),
  0,
);
t(
  "h1 inside svg foreignObject (HTML integration point) counts",
  PAGE.replace(
    "<h1>Page</h1>",
    "<svg><foreignObject><h1>y</h1></foreignObject></svg>",
  ),
  0,
);
t(
  "svg <title> is an integration point — its h1 counts, not raw text",
  PAGE.replace("<h1>Page</h1>", "<svg><title><h1>y</h1></title></svg>"),
  0,
);
t(
  "first <base> WITH href wins (href-less <base> skipped)",
  inBody('<base><base href="/sub/"><a href="y.png">x</a>'),
  0,
  { "sub/y.png": "x" },
);

// ── Round 15: non-rendered/fallback content is never link-scanned ──────────
t(
  "CDATA text node: link and h1 inside it are invisible (foreign content)",
  inBody(
    "<svg><text><![CDATA[ <h1>fake</h1> <a href=/dead-cdata> ]]></text></svg>",
  ),
  0,
);
t(
  "iframe fallback content is a child document — link not scanned",
  inBody("<iframe><a href=/dead-iframe></iframe>"),
  0,
);
t(
  "iframe src is kept and checked (open tag survives)",
  inBody('<iframe src="/missing-frame.html"></iframe>'),
  1,
);
t(
  "object fallback content never renders — link not scanned",
  inBody("<object><a href=/dead-obj></object>"),
  0,
);
t(
  "plaintext runs to EOF — trailing link not scanned",
  inBody("<plaintext><a href=/dead-plain>"),
  0,
);
t("xmp raw-text body not scanned", inBody("<xmp><a href=/dead-xmp></xmp>"), 0);
t(
  "noframes raw-text body not scanned",
  inBody("<noframes><a href=/dead-noframes></noframes>"),
  0,
);
t(
  "<?php ... ?> is a bogus comment — dropped to its first >",
  inBody("<?php echo '<a href=/dead-php>'; ?>"),
  0,
);
t(
  "<!foo ...> non-doctype markup declaration is a bogus comment",
  inBody("<!foo href=/dead-bogus>"),
  0,
);

// ── Round 16: object data= is a fetch target, duplicate attrs first-wins,
//    foreign titles never the document title ────────────────────────────────
t(
  "<object data> is scanned — missing target reds",
  inBody('<object data="/missing.bin"></object>'),
  1,
);
t(
  "<object data> present target passes",
  inBody('<object data="obj.bin"></object>'),
  0,
  { "obj.bin": "b" },
);
t(
  "plain data= on a non-object element is not a fetch target",
  inBody('<div data="/nope.bin"></div>'),
  0,
);
t(
  "duplicate href: browsers keep the first — second never fetched",
  inBody('<a href="/work/" href="/nope-dup/">x</a>'),
  0,
  { "work/index.html": SUB_PAGE },
);
t(
  "svg <title> in head (before <body>) is not the document title",
  PAGE.replace("<title>Page</title>", "<svg><title>diagram</title></svg>"),
  1,
);

// ── Round 17 → 18: `<svg / >` is NOT self-closing (whitespace after `/`
//    drops the flag — WHATWG self-closing start tag state; parse5, html5lib
//    and Chromium all agree) — verdicts flipped to browser truth at round 18;
//    documented fetch-attribute boundaries ───────────────────────────────────
t(
  "<svg / > stays open — its title lands in the svg, not the head",
  PAGE.replace("<title>Page</title>", "<svg / ><title>Page</title>"),
  1,
);
t(
  "<svg / > stays open — title behind it is a foreign label whose h1 counts",
  PAGE.replace("<h1>Page</h1>", "<svg / ><title><h1>y</h1></title></svg>"),
  0,
);
t(
  "<math / > stays open — its title lands in the math, not the head",
  PAGE.replace("<title>Page</title>", "<math / ><title>Page</title>"),
  1,
);
// ── Round 18: value-aware self-closing via the attribute state machine
//    (an unquoted value swallows the `/`; structural `/` before `>` sets
//    the flag) — walk and title filter derive from one helper ──────────────
t(
  "<svg title=x/> — unquoted value swallows the slash, tag stays open",
  PAGE.replace("<title>Page</title>", "<svg title=x/><title>Page</title>"),
  1,
);
t(
  "<svg /> — structural slash before `>` self-closes",
  PAGE.replace("<title>Page</title>", "<svg /><title>Page</title>"),
  0,
);
t(
  '<svg title="x"/> — quoted value ends before the slash, self-closes',
  PAGE.replace("<title>Page</title>", '<svg title="x"/><title>Page</title>'),
  0,
);
t(
  "<svg a=b c/> — slash glued to an attribute name still self-closes",
  PAGE.replace("<title>Page</title>", "<svg a=b c/><title>Page</title>"),
  0,
);
t(
  "video poster= is a documented non-checked fetch attribute",
  inBody('<video poster="/dead-poster.jpg"></video>'),
  0,
);
t(
  "form action=/formaction= are documented non-checked fetch attributes",
  inBody(
    '<form action="/dead-form"><button formaction="/dead-fc">x</button></form>',
  ),
  0,
);
