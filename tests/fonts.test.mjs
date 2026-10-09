/**
 * ENG-102 — regression battery for scripts/check-fonts.mjs, plus the
 * source-level font contract.
 *
 * Two halves, deliberately separated:
 *
 *  1. Source contract (reads src/ and public/fonts/): the subsets exist, are
 *     valid WOFF2, ship the OFL licence, are byte-identical to what
 *     tools/build-fonts.py produces, the CSS declares the faces, the head
 *     preloads the latin face, and the locked `--font-sans` token is
 *     untouched. These hold with or without a build.
 *
 *  2. Built-output gate (runs scripts/check-fonts.mjs against a hand-built
 *     fixture dist/): the compiled stylesheet still declares Inter, no
 *     unicode-range was corrupted, and the preload survives. Fixture-built
 *     rather than read from the repo's dist/ because `npm test` runs BEFORE
 *     `npm run build` in both `npm run verify` and CI — a suite that read the
 *     real dist/ failed on every clean checkout. (It did, once.) It is also why
 *     each scenario below is pinned rather than run against whatever happens to
 *     be built: the battery proves the gate REDS on the regressions it exists
 *     to catch.
 *
 * Wired into `npm run verify` and the CI job alongside the check-dist,
 * check-seo and check-work suites.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS_DIR = join(REPO_ROOT, "public/fonts");
const CHECK_SCRIPT = join(REPO_ROOT, "scripts/check-fonts.mjs");

/**
 * sha256 of each committed subset, as printed by tools/build-fonts.py.
 * Update deliberately — a change here is a change to the shipped font bytes.
 */
const SUBSET_SHA256 = {
  "inter-latin.woff2":
    "498fff05cc8109b8b5e386c1ef0e6d633c04145358b69370cd998fe06ea1b063",
  "inter-latin-ext.woff2":
    "552f7b35ca3957236dfb10a05c46e1b9b286508810677ec896e02d9e38e20d1d",
};

/* ------------------------------------------------------------------ *
 * Source contract — holds without a build
 * ------------------------------------------------------------------ */

/** WOFF2 signature is the ASCII "wOF2" — a truncated file, or an HTML error
 * page, would otherwise be served as a font and fail silently in the browser. */
function assertWoff2(file) {
  const buf = readFileSync(file);
  assert.equal(
    buf.subarray(0, 4).toString("latin1"),
    "wOF2",
    `${file.split("/").pop()} is not a WOFF2 container`,
  );
  assert.ok(
    buf.length > 1000,
    `${file.split("/").pop()} is suspiciously small`,
  );
}

describe("the Inter subsets are present and well formed", () => {
  test("both subsets ship", () => {
    for (const file of Object.keys(SUBSET_SHA256)) {
      assert.ok(
        existsSync(join(FONTS_DIR, file)),
        `public/fonts/${file} is missing`,
      );
      assertWoff2(join(FONTS_DIR, file));
    }
  });

  test("the OFL licence travels with the binaries", () => {
    // Inter is SIL Open Font License 1.1, which requires the licence to
    // accompany the font files. Shipping the binaries without it is a
    // licensing defect, not a cosmetic omission.
    const license = readFileSync(join(FONTS_DIR, "LICENSE.txt"), "utf8");
    assert.ok(
      /SIL OPEN FONT LICENSE/i.test(license),
      "public/fonts/LICENSE.txt does not contain the OFL text",
    );
  });

  test("the shipped subsets are the ones tools/build-fonts.py produces", () => {
    // Pins the exact bytes. That script asserts the axis configuration it
    // builds (wght pinned to 400-700, opsz kept on its native 14-32 range so
    // `font-optical-sizing: auto` tracks rendered size, no unexpected axis),
    // so a regenerated file that changes any of that fails here and has to be
    // updated deliberately.
    //
    // A CSS-only assertion cannot see this: pinning `opsz` at the 14px body
    // value would tune this site's 60px h1 and 48px h2 for body copy (measured
    // from upstream Inter, opsz 14 -> 32 moves a 15-character bold heading at
    // 60px by 23px, ~5%) while every font-family check still passed.
    //
    // Regenerating on a different fontTools/brotli version produces a different
    // compression, not different content (verified: 44,480 vs 44,612 bytes with
    // identical codepoints, glyphs and axes), so a mismatch here means "review
    // this deliberately", not "the build is broken". See the reproducibility
    // caveat in tools/build-fonts.py.
    for (const [file, sha] of Object.entries(SUBSET_SHA256)) {
      const actual = createHash("sha256")
        .update(readFileSync(join(FONTS_DIR, file)))
        .digest("hex");
      assert.equal(
        actual,
        sha,
        `${file} differs from the recorded build — regenerate with ` +
          "tools/build-fonts.py and update this hash deliberately",
      );
    }
  });
});

describe("the stylesheet declares the faces", () => {
  const css = readFileSync(join(REPO_ROOT, "src/styles/fonts.css"), "utf8");

  test("Inter is declared for the weights the design system uses", () => {
    // tokens.css: 400 body, 600 h3/labels, 700 h1/h2/display.
    assert.match(css, /font-family:\s*"Inter"/);
    assert.match(css, /font-weight:\s*400 700/);
  });

  test("font-display is swap, so text is never invisible", () => {
    assert.match(css, /font-display:\s*swap/);
  });

  test("both subsets are referenced, and unicode-range gates them", () => {
    assert.match(css, /url\("\/fonts\/inter-latin\.woff2"\)/);
    assert.match(css, /url\("\/fonts\/inter-latin-ext\.woff2"\)/);
    assert.equal(
      (css.match(/unicode-range:/g) ?? []).length,
      2,
      "each face needs a unicode-range or latin-ext is never skipped",
    );
  });

  test("the latin range starts at U+0001 and covers U+2192", () => {
    // U+0001, not U+0000: Astro's minifier corrupts any range starting at 0
    // into the invalid bytes `U+??`. U+0000 is NULL — never rendered.
    // U+2192 (→): the homepage Geography section and /about render
    // "Ethiopia → Africa → Global", and Google's published subset omits it, so
    // a stock subset falls back to a system arrow inside an Inter heading.
    const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map(
      (m) => m[1],
    );
    assert.equal(ranges.length, 2, "expected two unicode-range declarations");
    // Identify the latin face by its COVERAGE, not by its position. Asserting
    // `ranges[0]` false-reded with a message about the wrong face the moment
    // the two @font-face blocks were reordered — a change that is perfectly
    // valid and changes nothing about what ships.
    const latin = ranges.find((r) => /U\+0001-00FF/i.test(r));
    assert.ok(
      latin,
      `no @font-face covers basic Latin from U+0001; ranges were: ${ranges.join(
        " | ",
      )}`,
    );
    assert.match(latin, /U\+0001-00FF/, "the latin range starts at U+0001");
    assert.ok(
      latin.includes("U+2192"),
      "the latin range must cover U+2192 (→)",
    );
  });

  test("no external font provider is referenced", () => {
    assert.doesNotMatch(
      css,
      /https?:\/\//,
      "fonts must be self-hosted — an external provider is a third-party request",
    );
  });
});

describe("the head preloads the face every page needs", () => {
  const layout = readFileSync(
    join(REPO_ROOT, "src/layouts/BaseLayout.astro"),
    "utf8",
  );

  test("the latin face is preloaded", () => {
    assert.match(layout, /rel="preload"/);
    assert.match(layout, /href="\/fonts\/inter-latin\.woff2"/);
    assert.match(layout, /as="font"/);
  });

  test("preload carries crossorigin", () => {
    // Font fetches are always made in CORS mode; a preload without
    // crossorigin is fetched twice (once unused, once for real).
    assert.match(layout, /rel="preload"[\s\S]*?crossorigin/);
  });

  test("latin-ext is not preloaded", () => {
    // No page needs a codepoint outside the latin subset, so preloading it
    // would spend bandwidth on a face the browser never selects.
    const start = layout.indexOf('rel="preload"');
    assert.doesNotMatch(layout.slice(start, start + 400), /inter-latin-ext/);
  });

  test("fonts.css is imported before the token and global stylesheets", () => {
    assert.match(
      layout,
      /import "\.\.\/styles\/fonts\.css";\s*import "\.\.\/styles\/tokens\.css";\s*import "\.\.\/styles\/global\.css";/,
      "@font-face must be declared before the styles that reference the family",
    );
  });
});

describe("the locked font token is untouched", () => {
  const tokens = readFileSync(join(REPO_ROOT, "src/styles/tokens.css"), "utf8");

  test("--font-sans still names Inter first", () => {
    assert.match(
      tokens,
      /--font-sans:\s*Inter,\s*system-ui/,
      "ENG-102 locks the typography tokens — the stack must be unchanged",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Built-output gate — fixture dist/ per scenario
 * ------------------------------------------------------------------ */

/** The compiled stylesheet as the real build emits it. */
const GOOD_CSS =
  "@font-face{font-family:Inter;font-style:normal;font-weight:400 700;" +
  'font-display:swap;src:url(/fonts/inter-latin.woff2)format("woff2");' +
  "unicode-range:U+1-FF,U+131,U+152-153,U+2192,U+2212,U+FFFD}" +
  "@font-face{font-family:Inter;font-style:normal;font-weight:400 700;" +
  'font-display:swap;src:url(/fonts/inter-latin-ext.woff2)format("woff2");' +
  "unicode-range:U+100-2BA,U+2C7-2CC,U+A720-A7FF}";

/** Astro's actual output when the source range starts at U+0000. */
const CSS_WITH_CORRUPT_RANGE =
  "@font-face{font-family:Inter;font-style:normal;font-weight:400 700;" +
  'font-display:swap;src:url(/fonts/inter-latin.woff2)format("woff2");' +
  "unicode-range:U+??,U+131,U+152-153,U+2192,U+2212,U+FFFD}";

const GOOD_PRELOAD =
  '<link rel="preload" href="/fonts/inter-latin.woff2" as="font" ' +
  'type="font/woff2" crossorigin>';

function page(preload = GOOD_PRELOAD, extra = "") {
  return (
    '<!doctype html><html lang="en"><head><title>t</title>' +
    `<link rel="stylesheet" href="/_astro/BaseLayout.css">${preload}` +
    `<meta name="description" content="d"><meta name="viewport" content="width=device-width">` +
    `</head><body><main><h1>t</h1></main>${extra}</body></html>`
  );
}

/**
 * Build a fixture dist/ and run the gate against it.
 *
 * `expectPass: false` asserts the gate EXITS NON-ZERO — that is how a battery
 * proves the gate would actually catch the regression, rather than merely
 * agreeing with whatever the repo happens to have built.
 */
function runGate({
  css = GOOD_CSS,
  preload = GOOD_PRELOAD,
  extraHtml = "",
  assets = true,
  omitLicense = false,
}) {
  const dir = mkdtempSync(join(tmpdir(), "check-fonts-"));
  try {
    mkdirSync(join(dir, "_astro"), { recursive: true });
    mkdirSync(join(dir, "fonts"), { recursive: true });
    writeFileSync(join(dir, "_astro", "BaseLayout.css"), css);
    writeFileSync(join(dir, "index.html"), page(preload, extraHtml));
    if (assets) {
      for (const file of Object.keys(SUBSET_SHA256)) {
        writeFileSync(
          join(dir, "fonts", file),
          readFileSync(join(FONTS_DIR, file)),
        );
      }
      if (!omitLicense) {
        writeFileSync(
          join(dir, "fonts", "LICENSE.txt"),
          "SIL OPEN FONT LICENSE",
        );
      }
    }

    try {
      const stdout = execFileSync("node", [CHECK_SCRIPT, dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: stdout };
    } catch (error) {
      return {
        ok: false,
        output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check:fonts passes on correct output", () => {
  test("accepts a well-formed build", () => {
    const result = runGate({});
    assert.ok(
      result.ok,
      `expected the gate to pass, it failed:\n${result.output}`,
    );
    assert.match(result.output, /0 problems/);
  });
});

describe("check:fonts catches the regressions it exists for", () => {
  /** Every case must RED. A case that passes here proves nothing. */
  const cases = [
    [
      "the minifier's U+?? corruption survives the build",
      { css: CSS_WITH_CORRUPT_RANGE },
      /minifier-corrupted unicode-range/,
    ],
    [
      "no @font-face reaches the output",
      { css: "body{color:#171717}" },
      /no @font-face for Inter/,
    ],
    [
      "the latin face loses the → codepoint",
      {
        css: GOOD_CSS.replace("U+152-153,U+2192,U+2212", "U+152-153,U+2212"),
      },
      /omits U\+2192/,
    ],
    [
      "the latin range reverts to a U+0000 start",
      { css: GOOD_CSS.replace("U+1-FF", "U+0-FF") },
      /U\?\?|U\+0001/,
    ],
    [
      "the fonts are not emitted at all",
      { assets: false },
      /missing emitted asset/,
    ],
    [
      "the licence is not shipped with the binaries",
      { css: GOOD_CSS, assets: true, omitLicense: true },
      /missing emitted asset: fonts\/LICENSE\.txt/,
    ],
    ["the preload is dropped", { preload: "" }, /no font preload/],
    [
      "the preload loses crossorigin (fetched twice)",
      { preload: GOOD_PRELOAD.replace(" crossorigin", "") },
      /missing crossorigin/,
    ],
    [
      // One mutation, two independent defects it exposes: the latin face is no
      // longer preloaded, and a face no page needs is preloaded instead. An
      // earlier version listed this as two cases with byte-identical fixtures,
      // which made "12 regressions" read as 11.
      "the preload points at the wrong subset, preloading one no page needs",
      {
        preload: GOOD_PRELOAD.replace(
          "inter-latin.woff2",
          "inter-latin-ext.woff2",
        ),
      },
      /does not point at the latin subset[\s\S]*preloads inter-latin-ext/,
    ],
    [
      "the faces are served from an external font host",
      { extraHtml: '<script src="https://fonts.gstatic.com/x.js"></script>' },
      /external font host/,
    ],
    [
      "font-display is not swap",
      { css: GOOD_CSS.replace(/font-display:swap/g, "font-display:block") },
      /font-display: swap/,
    ],
  ];

  for (const [label, fixture, expected] of cases) {
    test(`RED on ${label}`, () => {
      const result = runGate(fixture);
      assert.ok(
        !result.ok,
        `the gate PASSED but should have failed — ${label}\n${result.output}`,
      );
      assert.match(result.output, expected);
    });
  }
});

describe("check:fonts refuses to run without a build", () => {
  test("exits non-zero when dist/ is absent", () => {
    // Same contract as check:dist and check:work: this gate reads build
    // output, so running it before `npm run build` is a usage error, not a
    // silent pass.
    const empty = join(tmpdir(), "check-fonts-missing-dist");
    assert.throws(
      () => execFileSync("node", [CHECK_SCRIPT, empty], { stdio: "pipe" }),
      /dist\/ not found/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The gate is wired into the documented pipelines
 * ------------------------------------------------------------------ */

describe("check:fonts is wired into verify and CI", () => {
  test("npm run verify runs it after the build", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    );
    assert.ok(pkg.scripts["check:fonts"], "package.json has no check:fonts");
    const verify = pkg.scripts.verify;
    assert.ok(
      verify.includes("npm run check:fonts"),
      "npm run verify does not run check:fonts",
    );
    // Must run AFTER the build — it reads dist/.
    assert.ok(
      verify.indexOf("npm run build") < verify.indexOf("npm run check:fonts"),
      "check:fonts must run after `npm run build` in verify",
    );
    // And after `npm test`, which is where the fixture battery lives.
    assert.ok(
      verify.indexOf("npm run test") < verify.indexOf("npm run check:fonts"),
      "check:fonts must run after the test battery",
    );
  });

  test("CI runs it after Build", () => {
    const workflow = readdirSync(join(REPO_ROOT, ".github/workflows")).find(
      (f) =>
        f.endsWith(".yml") &&
        readFileSync(join(REPO_ROOT, ".github/workflows", f), "utf8").includes(
          "npm run check:dist",
        ),
    );
    assert.ok(workflow, "could not find the CI workflow");
    const text = readFileSync(
      join(REPO_ROOT, ".github/workflows", workflow),
      "utf8",
    );
    assert.ok(
      text.includes("npm run check:fonts"),
      "CI does not run check:fonts",
    );
    assert.ok(
      text.indexOf("npm run build") < text.indexOf("npm run check:fonts"),
      "CI must run check:fonts after Build",
    );
  });
});
