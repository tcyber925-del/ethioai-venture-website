/**
 * ENG-95 — regression battery for scripts/check-work.mjs.
 *
 * Pinned per scenario so the verdicts hold regardless of the real build output:
 * each fixture dist/ is built by hand, and the check is run against it, so the
 * battery proves the check REDS on a dropped rule and a missing page rather
 * than merely passing against whatever the repo happens to have built.
 *
 * Wired into `npm run verify` and the CI job alongside the check-dist suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/check-work.mjs");

/** CSS carrying both hide rules, as the built output should look. */
const GOOD_CSS = `.filter[hidden]{display:none}.project-card[hidden]{display:none}`;

/**
 * What Astro ACTUALLY emits for a scoped component style: its own attribute
 * selector is injected between the class and `[hidden]`, and the rule lands in
 * an inline <style> block rather than the emitted stylesheet. Pinned here so the
 * gate cannot be "fixed" back into a form that misses the real build.
 */
const SCOPED_CID = "cgl2u52c";
const ASTRO_SCOPED_STYLE =
  `<style>.project-card[data-astro-cid-${SCOPED_CID}]{gap:var(--space-sm)}` +
  `.project-card[data-astro-cid-${SCOPED_CID}][hidden]{display:none}` +
  `.filter[data-astro-cid-${SCOPED_CID}][hidden]{display:none}</style>`;

/** CSS with the project-card hide rule dropped — the ENG-80 regression. */
const CSS_WITHOUT_CARD_RULE = `.filter[hidden]{display:none}`;

/** CSS that keeps the selector but drops the declaration. */
const CSS_SELECTOR_ONLY = `.filter[hidden]{display:none}.project-card[hidden]{color:red}`;

function fixture({
  css = GOOD_CSS,
  pages: builtPages = ["work/index.html", "work/ethiobio/index.html"],
  slugs = ["ethiobio"],
  html = "",
  nestedSlugs = [],
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-work-"));
  const dist = join(root, "dist");
  const projects = join(root, "src/content/projects");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(dist, "_astro", "index.css"), css);
  for (const page of builtPages) {
    mkdirSync(dirname(join(dist, page)), { recursive: true });
    writeFileSync(
      join(dist, page),
      `<!doctype html><title>x</title><h1>x</h1>${html}`,
    );
  }
  slugs.forEach((slug, index) =>
    writeFileSync(
      join(projects, `entry-${index}.md`),
      `---\nslug: ${slug}\n---\n`,
    ),
  );
  for (const [index, slug] of nestedSlugs.entries()) {
    const dir = join(projects, "nested");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `deep-${index}.md`), `---\nslug: ${slug}\n---\n`);
  }
  return { root, dist, projects };
}

function run(dist, projects) {
  try {
    const stdout = execFileSync(process.execPath, [script, dist, projects], {
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

test("passes when both hide rules and all pages are present", () => {
  const f = fixture();
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /check:work passed/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("finds the rules in a stylesheet that carries only design tokens", () => {
  // The real shape of the build: dist/_astro/*.css holds tokens, and the
  // component rules live elsewhere. Whichever file they land in, the gate must
  // see them.
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: ASTRO_SCOPED_STYLE,
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /check:work passed/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("matches Astro's injected scoping attribute between class and [hidden]", () => {
  // `.project-card[hidden]` never reaches the browser; the shipped selector is
  // `.project-card[data-astro-cid-…][hidden]`. A matcher that pinned the source
  // form would red on a healthy build.
  const f = fixture({ html: ASTRO_SCOPED_STYLE });
  try {
    assert.equal(run(f.dist, f.projects).code, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the scoped project-card rule is absent from the inline style", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: `<style>.filter[data-astro-cid-${SCOPED_CID}][hidden]{display:none}</style>`,
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project card hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the project-card hide rule is dropped from the build", () => {
  // The exact ENG-80 round-1 HIGH regression: the rule exists in source, the
  // build no longer emits it, and nothing else notices.
  const f = fixture({ css: CSS_WITHOUT_CARD_RULE });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project card hide rule/);
    assert.match(result.stderr, /ProjectCard\.astro/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the filter hide rule is dropped from the build", () => {
  const f = fixture({ css: ".project-card[hidden]{display:none}" });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing status filter hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the selector survives but its declaration does not", () => {
  // Half the rule surviving is still a broken filter, so it must red.
  const f = fixture({ css: CSS_SELECTOR_ONLY });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project card hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("tolerates minified declaration spacing and ordering", () => {
  const f = fixture({
    css: `.project-card[hidden] { display : none } .filter[hidden]{display:none}`,
  });
  try {
    assert.equal(run(f.dist, f.projects).code, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when a declared project page is missing from the build", () => {
  const f = fixture({ pages: ["work/index.html"] });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing built page: \/work\/ethiobio/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the /work index itself is missing", () => {
  const f = fixture({ pages: ["work/ethiobio/index.html"] });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing built page: \/work/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("requires a page for every declared project slug, not a fixed list", () => {
  // Deriving from the collection is what keeps the gate from going stale when
  // a project is added — a hardcoded list would only ever check the old ones.
  const f = fixture({
    pages: ["work/index.html", "work/ethiobio/index.html"],
    slugs: ["ethiobio", "newcomer"],
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing built page: \/work\/newcomer/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("reports a missing dist instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "check-work-"));
  try {
    const result = run(join(root, "absent"), join(root, "projects"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /dist\/ not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not require an external stylesheet when inline styles carry the rules", () => {
  // The real build has exactly one stylesheet holding tokens only; demanding a
  // .css containing the rules would fail a healthy site.
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: ASTRO_SCOPED_STYLE,
  });
  try {
    assert.equal(run(f.dist, f.projects).code, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when there is no CSS and no HTML to inspect", () => {
  const root = mkdtempSync(join(tmpdir(), "check-work-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  try {
    const result = run(dist, join(root, "projects"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no CSS or HTML output/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("still requires the /work index when no content collection is present", () => {
  // Pointed at an unrelated build: there are no project slugs to expect, but
  // the surface this check guards must still exist.
  const root = mkdtempSync(join(tmpdir(), "check-work-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  writeFileSync(join(dist, "_astro", "a.css"), GOOD_CSS);
  try {
    assert.equal(run(dist, join(root, "absent-projects")).code, 1);
    mkdirSync(join(dist, "work"), { recursive: true });
    writeFileSync(join(dist, "work", "index.html"), "<!doctype html>");
    assert.equal(run(dist, join(root, "absent-projects")).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Negative cases the gate must NOT pass -------------------------------
// Review round 1 found the <style> "extraction" was a no-op, so the gate
// scanned raw page text: a selector named in prose, in an HTML comment, or in an
// attribute value satisfied it with the real rule deleted from the stylesheet.
// These lock that down.

test("fails when the rule appears only as prose in the page body", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: "<p>Remember to keep .project-card[hidden] { display: none } working.</p>",
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project card hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when both rules sit in an HTML comment with zero shipped CSS", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: "<!-- .project-card[hidden] { display: none } .filter[hidden] { display: none } -->",
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing project card hide rule/);
    assert.match(result.stderr, /missing status filter hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the rule is only a CSS comment inside a real style block", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: "<style>/* .project-card[hidden] { display: none } */</style>",
  });
  try {
    assert.equal(run(f.dist, f.projects).code, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("fails when the rule appears only inside an attribute value", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: '<div data-note=".project-card[hidden] { display: none }"></div>',
  });
  try {
    assert.equal(run(f.dist, f.projects).code, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("still passes when the rule is inside a real style block, and names the carrier", () => {
  const f = fixture({
    css: ":root{--color-primary:#171717}",
    html: ASTRO_SCOPED_STYLE,
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /project card hide rule/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("discovers slugs in nested collection directories", () => {
  const f = fixture({
    pages: ["work/index.html", "work/ethiobio/index.html"],
    nestedSlugs: ["deep-project"],
  });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /deep-project/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("ignores a slug: line in the body and a trailing comment", () => {
  const root = mkdtempSync(join(tmpdir(), "check-work-"));
  const dist = join(root, "dist");
  const projects = join(root, "src/content/projects");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(dist, "_astro", "a.css"), GOOD_CSS);
  mkdirSync(join(dist, "work"), { recursive: true });
  writeFileSync(join(dist, "work", "index.html"), "<!doctype html>");
  writeFileSync(
    join(projects, "entry.md"),
    "---\nslug: real-slug  # trailing comment\n---\n\nslug: body-mention\n",
  );
  try {
    const result = run(dist, projects);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /real-slug/);
    assert.doesNotMatch(result.stderr, /body-mention/);
    assert.doesNotMatch(result.stderr, /trailing comment/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts flat file.html build output as well as directory format", () => {
  const f = fixture({ pages: ["work.html", "work/ethiobio.html"] });
  try {
    const result = run(f.dist, f.projects);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
