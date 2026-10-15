/**
 * ENG-107 — regression battery for scripts/check-cta.mjs.
 *
 * Each fixture dist/ is built by hand and the gate is run against it, so the
 * battery proves the gate REDS on every regression it exists to catch rather
 * than merely passing against whatever the repo happens to have built. Same
 * discipline as tests/check-work.test.mjs and tests/check-a11y.test.mjs.
 *
 * The fixture's measure lives in an INLINE <style> block on purpose: Astro
 * inlines page-level styles, and a gate that only read the linked stylesheet
 * would pass while the page shipped 72ch. The "reads inline styles" test below
 * is what holds that line.
 *
 * Wired into `npm run verify` and the CI job alongside the other dist gates.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/check-cta.mjs");

/** Fixture roots, removed after the suite so runs leave no temp dirs behind. */
const created = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** The focus rule the keyboard journey depends on, as the bundle carries it. */
const FOCUS_CSS = ":focus-visible{outline:2px solid var(--color-tertiary)}";

/** The editorial measure, in the inline style block Astro emits. */
const MEASURE_CSS = ".page-header{max-width:60ch}";

/** The CTA region, as StartProjectCta renders it for a sequence page. */
function ctaRegion(hrefs) {
  const actions = hrefs
    .map(
      (href) =>
        `<a href="${href}" class="btn btn--primary">${
          href === "/start-a-project" ? "Start a Project" : "View Work"
        }</a>`,
    )
    .join("");
  return (
    '<section class="cta" aria-label="Start a Project">' +
    `<div class="cta__actions">${actions}</div>` +
    "</section>"
  );
}

/** A page whose CTA closes the reading order, with a heading above it. */
function page({
  heading = "Work",
  cta = ctaRegion(["/start-a-project"]),
} = {}) {
  return (
    `<!doctype html><title>${heading}</title>` +
    '<link rel="stylesheet" href="/_astro/index.css">' +
    `<h1>${heading}</h1>` +
    `<style>${MEASURE_CSS}</style>` +
    `<main><h2>Section</h2><p>Prose.</p>${cta}</main>`
  );
}

function fixture({
  work = page(),
  research = page({ heading: "Research" }),
  solutions = page({
    heading: "Solutions",
    cta: ctaRegion(["/start-a-project", "/work"]),
  }),
  focusCss = FOCUS_CSS,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-cta-"));
  created.push(root);
  const dist = join(root, "dist");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  writeFileSync(join(dist, "_astro", "index.css"), focusCss);
  for (const [route, html] of [
    ["work", work],
    ["research", research],
    ["solutions", solutions],
  ]) {
    if (html === null) continue;
    mkdirSync(join(dist, route), { recursive: true });
    writeFileSync(join(dist, route, "index.html"), html);
  }
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
  assert.match(result.stdout, /check:cta passed/);
});

test("REDS when a sequence page loses the CTA region", () => {
  const { dist } = fixture({ work: page({ cta: "" }) });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\/work: no CTA region/);
});

test("REDS when the CTA drops its Start a Project action", () => {
  const { dist } = fixture({ research: page({ cta: ctaRegion([]) }) });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\/research: the CTA region does not link/);
});

test("REDS when a sequence page offers its own route as the secondary action", () => {
  // The `secondary={false}` prop dropped from the call site: /work would then
  // offer "View Work" on the Work page.
  const { dist } = fixture({
    work: page({ cta: ctaRegion(["/start-a-project", "/work"]) }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /links to its own route \(\/work\)/);
});

test("REDS when a heading follows the CTA region", () => {
  const { dist } = fixture({
    work: page().replace("</main>", "<h2>After</h2></main>"),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /a heading follows the CTA region/);
});

test("REDS when the CTA renders its pending fallback", () => {
  const { dist } = fixture({
    work: page().replace("cta__actions", "cta__actions cta__pending"),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /renders its pending fallback/);
});

test("REDS when the Solutions CTA loses an action", () => {
  // The shared component's prop default changed, quietly dropping "View Work"
  // from the page that is supposed to keep both.
  const { dist } = fixture({
    solutions: page({
      heading: "Solutions",
      cta: ctaRegion(["/start-a-project"]),
    }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\/solutions: the CTA region lost its \/work/);
});

test("reads the page's INLINE styles, not just the linked bundle", () => {
  // The false-pass this gate exists to avoid: 72ch inlined into the document
  // while the linked stylesheet stays clean.
  const { dist } = fixture({
    work: page().replace("max-width:60ch", "max-width:72ch"),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /max-width: 72ch, about 72ch/);
  assert.match(result.stderr, /past the 60ch editorial measure/);
});

test("REDS on a wider measure hidden in a calc()", () => {
  const { dist } = fixture({
    research: page().replace(
      "max-width:60ch",
      "max-width:calc(72ch + var(--space-lg))",
    ),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /about 72ch/);
});

test("accepts the marker-gutter calc() that adds to 60ch", () => {
  const { dist } = fixture({
    work: page().replace(
      "max-width:60ch",
      "max-width:calc(60ch + var(--space-lg))",
    ),
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("leaves non-ch widths alone", () => {
  // A rem form column and a percentage container are not prose measures.
  const { dist } = fixture({
    work: page().replace(
      "max-width:60ch",
      "max-width:60ch}.wide-form{max-width:40rem}.container{max-width:100%",
    ),
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("sweeps every built page, not only the CTA pages", () => {
  const { dist } = fixture();
  const aboutDir = join(dist, "about");
  mkdirSync(aboutDir, { recursive: true });
  writeFileSync(
    join(aboutDir, "index.html"),
    page({ heading: "About" }).replace("max-width:60ch", "max-width:72ch"),
  );
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /\/about\//);
});

test("REDS when the focus indicator disappears", () => {
  const { dist } = fixture({ focusCss: ":focus-visible{outline:none}" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /declare no visible indicator/);
});

test("REDS when no :focus-visible rule survives the build", () => {
  const { dist } = fixture({ focusCss: "a{color:red}" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no :focus-visible rule survives/);
});

test("accepts a box-shadow focus indicator", () => {
  const { dist } = fixture({
    focusCss: ":focus-visible{box-shadow:0 0 0 3px var(--color-tertiary)}",
  });
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr);
});

test("REDS rather than passing vacuously when no CTA page was built", () => {
  const { dist } = fixture({ work: null, research: null, solutions: null });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /would otherwise pass vacuously/);
});

test("REDS when dist/ is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "check-cta-empty-"));
  created.push(root);
  const result = run(join(root, "dist"));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /dist\/ not found/);
});
