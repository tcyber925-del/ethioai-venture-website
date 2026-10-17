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

/*
 * ENG-106 — the /work card's single-hit-target contract, in the shape Astro
 * actually emits it: scoped `[data-astro-cid-…]` attributes, the overlay
 * pseudo-element minified to the ONE-colon `a:after`, and the reduced-motion
 * override inside an at-rule. Split into parts so each RED case can drop or
 * alter exactly one of them.
 */
const CARD_GRID_CSS = ".project-grid{list-style:none;padding:0;margin:0}";
const CARD_ROOT_CSS =
  ".project-card[data-astro-cid-c]{display:flex;border:1px solid var(--color-border);position:relative;transition:border-color .15s}";
const CARD_STATE_CSS =
  ".project-card[data-astro-cid-c]:hover,.project-card[data-astro-cid-c]:focus-within{border-color:var(--color-secondary)}";
const CARD_OVERLAY_CSS =
  '.project-card__title[data-astro-cid-c] a:after{content:"";position:absolute;inset:0}';
const CARD_REDUCED_CSS =
  "@media (prefers-reduced-motion:reduce){.project-card[data-astro-cid-c]{transition:none}}";

/** A compliant card's CSS: every part present, nothing else. */
function cardCss({
  root = CARD_ROOT_CSS,
  state = CARD_STATE_CSS,
  overlay = CARD_OVERLAY_CSS,
  reduced = CARD_REDUCED_CSS,
  extra = "",
} = {}) {
  return [CARD_GRID_CSS, root, state, overlay, reduced, extra]
    .filter(Boolean)
    .join("");
}

/**
 * One work card in the grid. `extraAnchor` adds a SECOND interactive element
 * (the regression the stretched-overlay technique exists to prevent);
 * `extraControl` adds a button. Both default off, so the compliant fixture is
 * the shipped shape: one anchor inside the h3, nothing else focusable.
 */
function card({ extraAnchor = false, extraControl = "" } = {}) {
  return (
    '<ul class="project-grid" role="list">' +
    '<li class="project-card" data-project-status="pilot">' +
    '<div class="project-card__meta"><span>Pilot</span></div>' +
    '<h3 class="project-card__title">' +
    `<a href="/work/ethiobio" class="link">EthioBio</a>` +
    (extraAnchor ? '<a href="/work/ethiobio#related">Related</a>' : "") +
    "</h3>" +
    (extraControl ? `<button type="button">${extraControl}</button>` : "") +
    '<p class="project-card__summary">A summary.</p>' +
    "</li></ul>"
  );
}

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
  cardCss: cardCssText,
  cardHtml,
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
      // Component-scoped CSS ships inlined in the page's own <style>, which is
      // where the work card's rules land in a real build.
      (cardCssText || inlineStyle
        ? `<style>${inlineStyle}${cardCssText ?? ""}</style>`
        : "") +
      listHtml +
      (cardHtml ?? "") +
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

/*
 * ENG-106 — the four card assertions of scripts/check-a11y.mjs, each proven
 * RED against a fixture that violates exactly that one. A gate that cannot be
 * shown to fail is a gate that cannot be trusted to pass.
 */

test("passes a compliant work card", () => {
  const { dist } = fixture({ cardCss: cardCss(), cardHtml: card() });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test("REDS when a card gains a second interactive element", () => {
  const { dist } = fixture({
    cardCss: cardCss(),
    cardHtml: card({ extraAnchor: true }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /holds 2 <a> element\(s\).*exactly one/s);
});

test("REDS when a card gains a button alongside its title link", () => {
  const { dist } = fixture({
    cardCss: cardCss(),
    cardHtml: card({ extraControl: "Filter" }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /holds a control beyond its title link/);
});

test("REDS when the card root loses its positioning context", () => {
  // `position: relative` dropped: the overlay would then resolve against an
  // ancestor and no longer stretch across the card.
  const { dist } = fixture({
    cardCss: cardCss({
      root: ".project-card[data-astro-cid-c]{display:flex;border:1px solid var(--color-border);transition:border-color .15s}",
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not establish a positioning context/);
});

test("REDS when the card's zero-inset overlay is removed", () => {
  const { dist } = fixture({
    cardCss: cardCss({ overlay: "" }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /carries no absolutely positioned zero-inset/);
});

test("REDS when the overlay is present but no longer covers the card", () => {
  // Absolute without zero inset positions against the viewport, not the card —
  // the rule ships, the contract does not.
  const { dist } = fixture({
    cardCss: cardCss({
      overlay:
        '.project-card__title[data-astro-cid-c] a:after{content:"";position:absolute;top:0;left:0}',
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /carries no absolutely positioned zero-inset/);
});

test("REDS when the card loses its :focus-within state", () => {
  // Hover-only feedback leaves keyboard users with no state at all.
  const { dist } = fixture({
    cardCss: cardCss({
      state:
        ".project-card[data-astro-cid-c]:hover{border-color:var(--color-secondary)}",
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no :focus-within rule setting border-color/);
});

test("REDS when the hover and focus states re-state the default boundary", () => {
  // A rule that only re-states --color-border satisfies "border-color: <token>"
  // while changing nothing the user can see.
  const { dist } = fixture({
    cardCss: cardCss({
      state:
        ".project-card[data-astro-cid-c]:hover,.project-card[data-astro-cid-c]:focus-within{border-color:var(--color-border)}",
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /re-states the default boundary token/);
});

test("REDS when the reduced-motion override is dropped", () => {
  const { dist } = fixture({
    cardCss: cardCss({ reduced: "" }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no prefers-reduced-motion rule neutralises/);
});

test("the blanket global reduced-motion rule does not satisfy the card check", () => {
  // global.css sets `transition-duration: .01ms !important` on `*` for every
  // user. That must not be mistaken for the card honouring reduced motion: the
  // gate requires a rule targeting .project-card itself.
  const { dist } = fixture({
    cardCss: cardCss({
      reduced:
        "@media (prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}",
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no prefers-reduced-motion rule neutralises/);
});

test("accepts the four-longhand zero inset on the overlay", () => {
  const { dist } = fixture({
    cardCss: cardCss({
      overlay:
        '.project-card__title[data-astro-cid-c] a:after{content:"";position:absolute;top:0;right:0;bottom:0;left:0}',
    }),
    cardHtml: card(),
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("does not require the card contract on a page that renders no cards", () => {
  // The card assertions are scoped to pages carrying `.project-card`; the nav
  // and list gates still apply there.
  const { dist } = fixture();
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
 * ENG-107 — regression battery for the in-content "Start a Project" CTA
 * assertions appended to scripts/check-a11y.mjs.
 *
 * Same discipline as the battery above: each fixture is built by hand and the
 * gate is run against it, so every assertion is proven to RED on the
 * regression it exists to catch. The fixtures use `listHtml` — the fixture
 * helper's page-content slot — to carry the page body inside
 * `<main id="main">`, which is the region the gate scopes to.
 */

/** The /work evidence block, as the built index ships it. */
const WORK_EVIDENCE =
  '<ul class="project-grid" role="list">' +
  '<li class="project-card"><h3><a href="/work/a">A</a></h3></li>' +
  '<li class="project-card"><h3><a href="/work/b">B</a></h3></li>' +
  "</ul>";

/** The /research empty state, as the built index ships it while empty. */
const RESEARCH_EMPTY =
  '<div class="empty-state"><p>No research has been published yet.</p></div>';

/** The CTA region, primary action only, as it ships on the two indexes. */
const CTA =
  '<section class="cta" aria-label="Start a Project"><div class="cta__actions">' +
  '<a href="/start-a-project" class="btn btn--primary">Start a Project</a>' +
  "</div></section>";

/**
 * One evidence-index fixture. `navLinks` lets a case add the shell nav's own
 * "Start a Project" item, which must never be counted as in-content.
 */
function ctaFixture({ route = "work", content, navLinks }) {
  const current = `/${route}`;
  const links = navLinks ?? ["/solutions", current, "/about"];
  return fixture({
    route,
    listHtml: `<main id="main">${content}</main>`,
    primaryNav: nav("Primary", links, { currentHref: current }),
    footerNav: nav("Footer", links, { currentHref: current }),
  });
}

test("passes on a compliant Work index: one in-content CTA after the evidence", () => {
  const { dist } = ctaFixture({ content: WORK_EVIDENCE + CTA });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test("passes on a compliant Research index: CTA after the empty state", () => {
  const { dist } = ctaFixture({
    route: "research",
    content: RESEARCH_EMPTY + CTA,
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test("does not count the shell nav's own /start-a-project links", () => {
  // The gate scopes to <main>: the header and footer nav items are expected
  // on every page and must not be read as in-content CTAs.
  const { dist } = ctaFixture({
    content: WORK_EVIDENCE + CTA,
    navLinks: ["/solutions", "/work", "/start-a-project"],
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test("REDS when the in-content CTA is missing entirely", () => {
  // Proves the CTA check is not a silent skip on a laid-out page: a page with
  // a <main> region and no CTA is a regression, not an absence of one.
  const { dist } = ctaFixture({ content: WORK_EVIDENCE });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /expected exactly one in-content "Start a Project" CTA inside <main>, found 0/,
  );
});

test("REDS when a second in-content CTA is added", () => {
  const { dist } = ctaFixture({ content: WORK_EVIDENCE + CTA + CTA });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /exactly one in-content "Start a Project" CTA/);
});

test("REDS when the in-content CTA wording is altered", () => {
  const { dist } = ctaFixture({
    content:
      WORK_EVIDENCE +
      '<section class="cta"><div class="cta__actions">' +
      '<a href="/start-a-project" class="btn btn--primary">Start a project</a>' +
      "</div></section>",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /CTA text is "Start a project"/);
});

test("REDS when the CTA moves before the evidence", () => {
  const { dist } = ctaFixture({ content: CTA + WORK_EVIDENCE });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /CTA appears before the last \.project-card/);
});

test("REDS when the research CTA is nested inside the empty state", () => {
  // The CTA must not read as part of the "nothing published yet" panel, and
  // the empty state's copy must not gain a CTA region of its own.
  const { dist } = ctaFixture({
    route: "research",
    content: `<div class="empty-state"><p>No research has been published yet.</p>${CTA}</div>`,
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /CTA sits inside the empty state/);
});

test("REDS when the research CTA moves before the entry list", () => {
  const { dist } = ctaFixture({
    route: "research",
    content: CTA + '<ul class="entry-list" role="list"><li>a</li></ul>',
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /CTA appears before the \.entry-list/);
});
