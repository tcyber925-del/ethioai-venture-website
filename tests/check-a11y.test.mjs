/**
 * ENG-103 — regression battery for scripts/check-a11y.mjs.
 *
 * Each fixture dist/ is built by hand and the gate is run against it, so the
 * battery proves the gate REDS on every regression it exists to catch rather
 * than merely passing against whatever the repo happens to have built. Same
 * discipline as tests/check-work.test.mjs.
 *
 * Wired into `npm run verify` and the CI job alongside the other dist gates.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/check-a11y.mjs");

/** Fixture roots, removed after the suite so runs leave no temp dirs behind. */
const created = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Nav CSS as the emitted stylesheet carries it (Astro-scoped). */
const NAV_CSS =
  ".primary-nav[data-astro-cid-h] a{padding-block:var(--space-xs);display:inline-block}" +
  ".footer-nav[data-astro-cid-f] a{padding-block:var(--space-xs);display:inline-block}";

/** The Work filter chip's default border rule, Astro-scoped. */
const CHIP_CSS =
  ".filter__chip[data-astro-cid-w]{padding:var(--space-xs);border:1px solid var(--color-secondary)}";

/** The chip's pressed state, carrying the non-colour (weight) cue. */
const CHIP_PRESSED_CSS =
  '.filter__chip[data-astro-cid-w][aria-pressed="true"]{border-color:var(--color-tertiary);font-weight:var(--text-label-weight)}';

/** A marker-stripped list class, as the built CSS carries it. */
const LIST_CSS = ".card-grid{list-style:none;padding:0}";

/** The design tokens the gate resolves against (mirrors :root in tokens.css). */
const ROOT_CSS = ":root{--space-xs:4px;--text-body-sm-leading:1.5}";

/** A marker-stripped list that keeps its role — the ENG-103 list fix. */
const LIST_HTML = '<ul class="card-grid" role="list"><li>a</li><li>b</li></ul>';

/** A nav list whose markers are removed — role="list" is the ENG-103 fix. */
function nav(label, links, { role = "list", currentHref } = {}) {
  const items = links
    .map(
      (href) =>
        `<li><a href="${href}"${
          href === currentHref ? ' aria-current="page"' : ""
        }>${href}</a></li>`,
    )
    .join("");
  const roleAttr = role === null ? "" : ` role="${role}"`;
  return `<nav aria-label="${label}"><ul${roleAttr}>${items}</ul></nav>`;
}

/** Links present in the nav of every fixture page. */
const NAV_LINKS = ["/solutions", "/work", "/about"];

function fixture({
  route = "work",
  navRole = "list",
  primaryCurrent = "/work",
  footerCurrent = "/work",
  chipCss = CHIP_CSS,
  chipPressedCss = CHIP_PRESSED_CSS,
  navCss = NAV_CSS,
  listCss = LIST_CSS,
  listHtml = LIST_HTML,
  linkCss = true,
  inlineStyle = "",
  primaryNav,
  footerNav,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-a11y-"));
  created.push(root);
  const dist = join(root, "dist");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  writeFileSync(
    join(dist, "_astro", "index.css"),
    `${ROOT_CSS}\n${navCss}\n${chipCss}${chipPressedCss}\n${listCss}`,
  );

  const page = join(dist, route, "index.html");
  mkdirSync(dirname(page), { recursive: true });
  writeFileSync(
    join(page),
    `<!doctype html><title>x</title><h1>x</h1>` +
      (linkCss ? '<link rel="stylesheet" href="/_astro/index.css">' : "") +
      (inlineStyle ? `<style>${inlineStyle}</style>` : "") +
      listHtml +
      (primaryNav ??
        nav("Primary", NAV_LINKS, {
          role: navRole,
          currentHref: primaryCurrent,
        })) +
      (footerNav ??
        nav("Footer", NAV_LINKS, {
          role: navRole,
          currentHref: footerCurrent,
        })),
  );
  return { root, dist };
}

function run(dist) {
  try {
    const stdout = execFileSync(process.execPath, [script, dist], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("passes on a compliant build", () => {
  const { dist } = fixture();
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /check:a11y passed/);
});

test("REDS when the chip boundary regresses to --color-border", () => {
  const { dist } = fixture({
    chipCss:
      ".filter__chip[data-astro-cid-w]{padding:var(--space-xs);border:1px solid var(--color-border)}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /chip default boundary uses --color-border/);
});

test("REDS when the chip pressed state loses its non-colour cue", () => {
  // Default-vs-pressed borders are ~1:1 in lightness, so a colour-only pressed
  // rule is a regression: the cue must be weight, thickness or shadow.
  const { dist } = fixture({
    chipPressedCss:
      '.filter__chip[data-astro-cid-w][aria-pressed="true"]{border-color:var(--color-tertiary);color:var(--color-tertiary)}',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no non-colour cue/);
});

test("accepts the chip pressed state when it carries a weight cue", () => {
  const { dist } = fixture({
    chipPressedCss:
      '.filter__chip[data-astro-cid-w][aria-pressed="true"]{border-color:var(--color-tertiary);font-weight:var(--text-label-weight)}',
  });
  const result = run(dist);
  assert.equal(result.code, 0);
});

test("REDS when the chip rule is missing entirely", () => {
  const { dist } = fixture({ chipCss: ".filter__count{color:red}" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not locate the Work filter chip/);
});

test("REDS when a nav list loses role=list", () => {
  const { dist } = fixture({ navRole: null });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /lost role="list"/);
});

test("REDS when aria-current is missing on the current route", () => {
  const { dist } = fixture({
    primaryNav: nav("Primary", NAV_LINKS, {}),
    footerNav: nav("Footer", NAV_LINKS, {}),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /marks \[\] aria-current, expected \[\/work\]/);
});

test("REDS when aria-current is added on a link that is not current", () => {
  const { dist } = fixture({
    primaryNav: nav("Primary", NAV_LINKS, { currentHref: "/about" }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /marks \[\/about\] aria-current, expected \[\/work\]/,
  );
});

test("REDS when nav links carry no block padding", () => {
  const { dist } = fixture({
    navCss: ".primary-nav[data-astro-cid-h] a{color:red}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when nav block padding is zeroed out", () => {
  const { dist } = fixture({
    navCss:
      ".primary-nav[data-astro-cid-h] a{padding-block:0}" +
      ".footer-nav[data-astro-cid-f] a{padding-block:0}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when block padding is zeroed via the two-value form", () => {
  const { dist } = fixture({
    navCss:
      ".primary-nav[data-astro-cid-h] a{padding-block:0 0}" +
      ".footer-nav[data-astro-cid-f] a{padding-block:0px 0px}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when block padding is zeroed with !important", () => {
  const { dist } = fixture({
    navCss:
      ".primary-nav[data-astro-cid-h] a{padding-block:0 !important}" +
      ".footer-nav[data-astro-cid-f] a{padding-block:0 !important}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when a page does not link the stylesheet carrying the nav rule", () => {
  // Per-page CSS scoping: a rule defined in a file this page never links must
  // not satisfy this page's check.
  const { dist } = fixture({ linkCss: false });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("accepts the nav rule when it arrives via an inline <style>", () => {
  const { dist } = fixture({
    linkCss: false,
    inlineStyle: `${ROOT_CSS}${NAV_CSS}`,
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("REDS when a marker-stripped list loses role=list", () => {
  const { dist } = fixture({
    listHtml: '<ul class="card-grid"><li>a</li><li>b</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /card-grid.*lost role="list"/);
});

test("does not require role=list on a list that keeps its markers", () => {
  // .principles keeps `list-style` markers, so it must NOT be forced to
  // role="list" — the gate only covers marker-stripped lists.
  const { dist } = fixture({
    listCss: ".principles{display:flex}",
    listHtml: '<ul class="principles"><li>a</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("REDS when a SECOND list of the same class loses role=list", () => {
  // The page ships two .card-grid lists; only the second is missing the role.
  const { dist } = fixture({
    listHtml:
      '<ul class="card-grid" role="list"><li>a</li></ul>' +
      '<ul class="card-grid"><li>b</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /card-grid.*lost role="list"/);
});

test("REDS when a marker-stripped <ol> loses role=list", () => {
  const { dist } = fixture({
    listCss: ".steps{list-style:none}",
    listHtml: '<ol class="steps"><li>a</li></ol>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /<ol class="steps">.*lost role="list"/);
});

test("REDS when list-style:none arrives only inside a media query", () => {
  // The class scan must see rules nested in @media, not just top-level ones.
  const { dist } = fixture({
    listCss: "@media (min-width:40em){.card-grid{list-style:none}}",
    listHtml: '<ul class="card-grid"><li>a</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /card-grid.*lost role="list"/);
});

test("REDS when list-style-type:none strips a list's markers", () => {
  // The longhand spelling must be caught, not only the `list-style` shorthand.
  const { dist } = fixture({
    listCss: ".card-grid{list-style-type:none}",
    listHtml: '<ul class="card-grid"><li>a</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /card-grid.*lost role="list"/);
});

test("REDS when a classless list is stripped by an ancestor selector", () => {
  // The 404's suggested-pages <ul> has no class; `.not-found__nav ul` strips it.
  const { dist } = fixture({
    listCss: ".not-found__nav ul{list-style:none}",
    listHtml: "",
    primaryNav:
      '<nav aria-label="Primary"><ul role="list"><li><a href="/work">w</a></li></ul></nav>',
    footerNav:
      '<nav aria-label="Footer"><ul role="list"><li><a href="/work">w</a></li></ul></nav>' +
      '<nav aria-label="Suggested pages" class="not-found__nav"><ul><li>a</li></ul></nav>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /<ul> is marker-stripped but lost role="list"/);
});

test("REDS when the target size is sub-minimum", () => {
  // A token that resolves below the 24px minimum must fail, not just a zero.
  const { dist } = fixture({
    navCss:
      ".primary-nav[data-astro-cid-h] a{padding-block:0.01px}" +
      ".footer-nav[data-astro-cid-f] a{padding-block:0.01px}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when a later padding shorthand overrides the block padding", () => {
  const { dist } = fixture({
    navCss:
      ".primary-nav[data-astro-cid-h] a{padding-block:var(--space-xs)}" +
      ".primary-nav[data-astro-cid-h] a{padding:0}" +
      ".footer-nav[data-astro-cid-f] a{padding-block:var(--space-xs)}" +
      ".footer-nav[data-astro-cid-f] a{padding:0}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when the spacing token resolves below the minimum", () => {
  // The gate must resolve var(--space-xs), so shrinking it is caught.
  const { dist } = fixture({
    listCss: ".card-grid{list-style:none}",
    listHtml: '<ul class="card-grid" role="list"><li>a</li></ul>',
    inlineStyle: ":root{--space-xs:1px}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not reach the 24x24/);
});

test("REDS when the primary nav is absent", () => {
  const { dist } = fixture({ primaryNav: "" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no <nav aria-label="Primary">/);
});

test("root route marks nothing current", () => {
  // On "/" no nav link targets the root, so none may be marked current.
  const { dist } = fixture({
    route: "",
    primaryCurrent: "/work",
    footerCurrent: "/work",
  });
  const result = run(dist);
  assert.equal(result.code, 1, "a non-root link marked current on / must RED");
  assert.match(result.stderr, /marks \[\/work\] aria-current, expected \[\]/);
});
