/**
 * Regression battery for scripts/check-seo.mjs (ENG-84 round-2).
 *
 * Run: node --test  — wired into `npm run verify` and the CI job.
 *
 * The script accepts a dist path as argv[2], so every scenario builds a
 * fixture dist and asserts the exit status (and, where useful, the
 * verdict line):
 *
 *   - head-scope <title> verdict: an <svg>/<math> <title> decoy can
 *     neither satisfy presence nor fake/unfairly-fail uniqueness, and a
 *     <title> after the <body> anchor never counts (mirrors check:dist);
 *   - title/description uniqueness across built pages;
 *   - noindex present if and only if the 404 page;
 *   - canonical == site.url + emitted path; noindex pages carry neither
 *     canonical nor og:url; non-noindex og:url under the site base;
 *   - sitemap <loc> liveness (dead entry or off-base loc reds);
 *   - robots.txt references the exact `Sitemap: <site.url>/sitemap.xml`.
 *
 * Keep in sync with the script's header, which documents each behavior.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../src/config/site.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "check-seo.mjs");

/** The one JSON-LD block BaseLayout emits — parseable on every page. */
const LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: site.name,
  url: `${site.url}/`,
  description: site.description,
});

/**
 * Minimal contract-satisfying page. Head pieces are opt-in/out so a
 * scenario can omit or corrupt exactly one: `title: undefined` → no
 * <title> tag, `description: undefined` → no description meta,
 * `canonical: null` → no canonical link, `og: false`/`twitter: false` →
 * no Open Graph/twitter tags, `ld: null` → no JSON-LD (a string is emitted
 * verbatim, so an unparseable block can be exercised).
 */
function page({
  title,
  description,
  canonical = null,
  ogUrl = canonical,
  robots,
  body = "",
  extraHead = "",
  og = true,
  twitter = true,
  ld = LD,
}) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    ...(description === undefined
      ? []
      : [`<meta name="description" content="${description}">`]),
    ...(title === undefined ? [] : [`<title>${title}</title>`]),
    ...(canonical ? [`<link rel="canonical" href="${canonical}">`] : []),
    ...(robots ? [`<meta name="robots" content="${robots}">`] : []),
    ...(og
      ? [
          '<meta property="og:type" content="website">',
          `<meta property="og:site_name" content="${site.name}">`,
          `<meta property="og:title" content="${title ?? site.name}">`,
          `<meta property="og:description" content="${description ?? ""}">`,
          ...(ogUrl ? [`<meta property="og:url" content="${ogUrl}">`] : []),
        ]
      : []),
    ...(twitter ? ['<meta name="twitter:card" content="summary">'] : []),
    ...(ld === null
      ? []
      : [`<script type="application/ld+json">${ld}</script>`]),
    extraHead,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
    "",
  ].join("\n");
}

const sitemapFor = (locs) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemaps/0.9">',
    ...locs.map((loc) => `  <url><loc>${loc}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");

const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`;

/** Baseline: home + about (canonical/og:url) + noindex 404 + artifacts. */
const goodFiles = () => ({
  "index.html": page({
    title: site.name,
    description: "Home description.",
    canonical: `${site.url}/`,
    ogUrl: `${site.url}/`,
  }),
  "about/index.html": page({
    title: `About · ${site.name}`,
    description: "About description.",
    canonical: `${site.url}/about/`,
    ogUrl: `${site.url}/about/`,
  }),
  "404.html": page({
    title: `Page not found · ${site.name}`,
    description: "404 description.",
    robots: "noindex",
  }),
  "robots.txt": ROBOTS,
  "sitemap.xml": sitemapFor([`${site.url}/`, `${site.url}/about/`]),
});

let base; // temp dir holding one dist/ per test
const dist = () => join(base, "dist");

before(() => {
  base = mkdtempSync(join(tmpdir(), "check-seo-"));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * Run one scenario: fresh dist/ written from the file map, then assert
 * the script's exit status (and an expected verdict substring, when
 * given) against argv[2] = that dist.
 */
const run = (files) => {
  rmSync(dist(), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dist(), rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const r = spawnSync(process.execPath, [script, dist()], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout + r.stderr).trim() };
};

/** One verdict test; `files` is the whole fixture dist for the scenario. */
const t = (name, files, want, needle) =>
  test(name, () => {
    const { status, out } = run(files);
    assert.equal(status, want, out);
    if (needle !== undefined) assert.ok(out.includes(needle), out);
  });

// ── Baseline ───────────────────────────────────────────────────────────────
t("clean dist passes", goodFiles(), 0, "check:seo passed");

// ── Head-scope title verdict (svg/body decoys) ─────────────────────────────
t(
  "svg <title> decoy in head cannot satisfy presence",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      body: "",
    }).replace("</head>", `<svg><title>${site.name}</title></svg></head>`),
  },
  1,
  "missing or empty <title>",
);

t(
  "<title> after the body anchor does not count",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      body: `<title>${site.name}</title>`,
    }),
  },
  1,
  "missing or empty <title>",
);

t(
  "svg label matching another page's title is not a duplicate",
  {
    ...goodFiles(),
    "misc/index.html": page({
      title: `Misc · ${site.name}`,
      description: "Misc description.",
      canonical: `${site.url}/misc/`,
      ogUrl: `${site.url}/misc/`,
      body: `<svg><title>About · ${site.name}</title></svg>`,
    }),
  },
  0,
  "check:seo passed",
);

t(
  "<title> inside an inline script body does not count",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      body: `<script>const decoy = "<title>${site.name}</title>";</script>`,
    }),
  },
  1,
  "missing or empty <title>",
);

t(
  "<title> inside an inline style body does not count",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      body: `<style>/* <title>${site.name}</title> */</style>`,
    }),
  },
  1,
  "missing or empty <title>",
);

t(
  "<svg title=x/> is not self-closing — a later <title> stays foreign",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      extraHead: `<svg title=x/><title>${site.name}</title>`,
    }),
  },
  1,
  "missing or empty <title>",
);

t(
  "<svg/> really self-closing — a later <title> counts",
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      extraHead: `<svg/><title>${site.name}</title>`,
    }),
  },
  0,
  "check:seo passed",
);

t(
  '<svg title="x"/> self-closes — a later <title> counts',
  {
    ...goodFiles(),
    "index.html": page({
      title: undefined,
      description: "Home description.",
      canonical: `${site.url}/`,
      ogUrl: `${site.url}/`,
      extraHead: `<svg title="x"/><title>${site.name}</title>`,
    }),
  },
  0,
  "check:seo passed",
);

// ── Title / description uniqueness ─────────────────────────────────────────
t(
  "duplicate head title across pages reds",
  {
    ...goodFiles(),
    "misc/index.html": page({
      title: `About · ${site.name}`,
      description: "Misc description.",
      canonical: `${site.url}/misc/`,
      ogUrl: `${site.url}/misc/`,
    }),
  },
  1,
  "duplicate <title>",
);

t(
  "duplicate meta description across pages reds",
  {
    ...goodFiles(),
    "misc/index.html": page({
      title: `Misc · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/misc/`,
      ogUrl: `${site.url}/misc/`,
    }),
  },
  1,
  "duplicate meta description",
);

// ── noindex iff the 404 page ───────────────────────────────────────────────
t(
  "404 without noindex reds",
  {
    ...goodFiles(),
    "404.html": page({
      title: `Page not found · ${site.name}`,
      description: "404 description.",
    }),
  },
  1,
  "404 page is missing noindex",
);

t(
  "noindex on a non-404 page reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      robots: "noindex",
    }),
  },
  1,
  "noindex on a page that is not the 404 page",
);

// ── canonical == emitted path; noindex pages declare nothing ───────────────
t(
  "canonical not equal to emitted path reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/wrong/`,
      ogUrl: `${site.url}/about/`,
    }),
  },
  1,
  "≠ emitted path",
);

t(
  "missing canonical on a non-noindex page reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
    }),
  },
  1,
  "expected exactly one rel=canonical",
);

t(
  "canonical on the noindex 404 reds",
  {
    ...goodFiles(),
    "404.html": page({
      title: `Page not found · ${site.name}`,
      description: "404 description.",
      canonical: `${site.url}/404/`,
      robots: "noindex",
    }),
  },
  1,
  "noindex page must not declare rel=canonical",
);

// ── Open Graph / twitter presence and og:url == canonical ────────────────
t(
  "missing og:url reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: null,
    }),
  },
  1,
  "missing og:url",
);

t(
  "og:url ≠ canonical reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: `${site.url}/elsewhere/`,
    }),
  },
  1,
  "≠ canonical",
);

t(
  "missing twitter:card reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: `${site.url}/about/`,
      twitter: false,
    }),
  },
  1,
  "missing twitter:card",
);

t(
  "missing Open Graph tags red",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      og: false,
    }),
  },
  1,
  "missing og:type",
);

// ── JSON-LD: present, parseable, WebSite ─────────────────────────────────
t(
  "missing JSON-LD reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: `${site.url}/about/`,
      ld: null,
    }),
  },
  1,
  "missing application/ld+json block",
);

t(
  "unparseable JSON-LD reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: `${site.url}/about/`,
      ld: "{not json",
    }),
  },
  1,
  "JSON-LD does not parse",
);

t(
  "JSON-LD @type other than WebSite reds",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      canonical: `${site.url}/about/`,
      ogUrl: `${site.url}/about/`,
      ld: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: site.name,
      }),
    }),
  },
  1,
  "JSON-LD @type",
);

// ── Head scoping: body-placed head tags never satisfy a check ────────────
t(
  "body-scoped canonical does not satisfy the check",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      description: "About description.",
      body: `<link rel="canonical" href="${site.url}/about/">`,
    }),
  },
  1,
  "expected exactly one rel=canonical",
);

t(
  "body-scoped meta description does not satisfy the check",
  {
    ...goodFiles(),
    "about/index.html": page({
      title: `About · ${site.name}`,
      body: `<meta name="description" content="Body decoy description.">`,
    }),
  },
  1,
  "missing or empty meta description",
);

t(
  "body-scoped noindex is ignored — the page still passes",
  {
    ...goodFiles(),
    "misc/index.html": page({
      title: `Misc · ${site.name}`,
      description: "Misc description.",
      canonical: `${site.url}/misc/`,
      ogUrl: `${site.url}/misc/`,
      body: `<meta name="robots" content="noindex">`,
    }),
  },
  0,
  "check:seo passed",
);

// ── Sitemap <loc> liveness ─────────────────────────────────────────────────
t(
  "dead sitemap <loc> reds",
  {
    ...goodFiles(),
    "sitemap.xml": sitemapFor([
      `${site.url}/`,
      `${site.url}/about/`,
      `${site.url}/ghost/`,
    ]),
  },
  1,
  "dead <loc>",
);

t(
  "sitemap <loc> off the site base reds",
  {
    ...goodFiles(),
    "sitemap.xml": sitemapFor([
      `${site.url}/`,
      `${site.url}/about/`,
      "https://example.com/elsewhere/",
    ]),
  },
  1,
  "not under",
);

// ── robots.txt → sitemap reference ─────────────────────────────────────────
t(
  "robots.txt without the sitemap line reds",
  { ...goodFiles(), "robots.txt": "User-agent: *\nAllow: /\n" },
  1,
  'missing "Sitemap:',
);
