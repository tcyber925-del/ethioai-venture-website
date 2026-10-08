/**
 * Self-hosted Inter (ENG-102).
 *
 * Why this exists: DESIGN.md names Inter as the primary expression of the
 * site's identity and `--font-sans` lists it first, but no `@font-face` ever
 * shipped — every visit rendered in the OS fallback face. Nothing in the
 * existing suite would have noticed if the font were removed again, because
 * `check:dist` only link-checks assets and cannot tell a served font from a
 * served string. These cases pin both halves: the assets exist and are valid
 * WOFF2, and the CSS actually references them.
 *
 * The checks that would catch a silent regression are the ones that read the
 * BUILT stylesheet, not the source: a `@font-face` that survives in
 * `src/styles/fonts.css` but is dropped by the build renders exactly like the
 * pre-ENG-102 site while every source-level assertion still passes.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const FONTS_DIR = path.join(REPO_ROOT, "public/fonts");
const DIST = path.join(REPO_ROOT, "dist");
const builtStylesheet = () => {
  const dir = path.join(DIST, "_astro");
  assert.ok(
    existsSync(dir),
    "dist/_astro not found — run `npm run build` before this suite.",
  );
  const css = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.equal(
    css.length,
    1,
    `expected one built stylesheet, found ${css.length}`,
  );
  return readFileSync(path.join(dir, css[0]), "utf8");
};

/** WOFF2 signature is the ASCII "wOF2" — a truncated or HTML error page
 * would otherwise be served as a font and fail silently in the browser. */
function assertWoff2(file) {
  const buf = readFileSync(file);
  assert.equal(
    buf.subarray(0, 4).toString("latin1"),
    "wOF2",
    `${path.basename(file)} is not a WOFF2 container`,
  );
  assert.ok(buf.length > 1000, `${path.basename(file)} is suspiciously small`);
  return buf;
}

describe("the Inter subsets are present and well formed", () => {
  test("the latin subset ships", () => {
    assert.ok(existsSync(path.join(FONTS_DIR, "inter-latin.woff2")));
    assertWoff2(path.join(FONTS_DIR, "inter-latin.woff2"));
  });

  test("the latin-ext subset ships", () => {
    assert.ok(existsSync(path.join(FONTS_DIR, "inter-latin-ext.woff2")));
    assertWoff2(path.join(FONTS_DIR, "inter-latin-ext.woff2"));
  });

  test("the OFL license travels with the binaries", () => {
    // Inter is SIL Open Font License 1.1, which requires the license to
    // accompany the font files. Shipping the binaries without it is a
    // licensing defect, not a cosmetic omission.
    const license = readFileSync(path.join(FONTS_DIR, "LICENSE.txt"), "utf8");
    assert.ok(
      /SIL OPEN FONT LICENSE/i.test(license),
      "public/fonts/LICENSE.txt does not contain the OFL text",
    );
  });
});

describe("the stylesheet declares the faces", () => {
  const css = readFileSync(
    path.join(REPO_ROOT, "src/styles/fonts.css"),
    "utf8",
  );

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

  test("U+2192 (→) is in the latin range the site renders in", () => {
    // The homepage Geography section and /about render "Ethiopia → Africa →
    // Global" as real content. Google Fonts' published latin subset omits
    // that codepoint, so a stock subset falls back to a system arrow inside
    // an Inter heading.
    //
    // Asserted against the BUILT stylesheet, whose unicode-range survives
    // minification — matching the source file would also match the prose in
    // this suite's own reference to the codepoint and pass on a face that no
    // longer declares it. (That is not hypothetical: a plain /U\+2192/ check
    // on the source survived a mutation that removed it from the range.)
    assert.match(
      builtStylesheet(),
      /unicode-range:[^}]*U\+2192/,
      "the latin face no longer covers U+2192 — the → arrows would fall back",
    );
    const latinRange = css.match(/unicode-range:\s*([^;]*U\+2192[^;]*);/);
    assert.ok(
      latinRange,
      "the latin face must declare U+2192 in unicode-range",
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

describe("the built output loads the font", () => {
  test("the shipped subsets are the ones tools/build-fonts.py produces", () => {
    // Pins the exact bytes. tools/build-fonts.py asserts the axis
    // configuration it builds (wght pinned to 400-700, opsz kept on its native
    // 14-32 range so `font-optical-sizing: auto` tracks rendered size, and no
    // unexpected axis surviving), so a regenerated file that changes any of
    // that fails here and has to be updated deliberately.
    //
    // A CSS-only assertion cannot see this: pinning `opsz` at the 14px body
    // value would tune this site's 60px h1 and 48px h2 for body copy
    // (measured from upstream Inter, opsz 14 -> 32 moves a 15-character bold
    // heading at 60px by 23px, ~5%) while every font-family check still passed.
    for (const [file, sha] of Object.entries(SUBSET_SHA256)) {
      const actual = createHash("sha256")
        .update(readFileSync(path.join(FONTS_DIR, file)))
        .digest("hex");
      assert.equal(
        actual,
        sha,
        `${file} differs from the recorded build — regenerate with ` +
          "tools/build-fonts.py and update this hash deliberately",
      );
    }
  });

  test("the built stylesheet still declares Inter", () => {
    const built = builtStylesheet();
    assert.match(built, /@font-face\{font-family:Inter/);
    assert.match(built, /url\(\/fonts\/inter-latin\.woff2\)/);
  });

  test("no unicode-range was corrupted by the build", () => {
    // Astro's CSS minifier rewrites any unicode-range token starting at 0
    // into the literal bytes `U+??` — not valid CSS. Chromium recovers it
    // because its parser treats `?` as a wildcard, but that is a lenient-
    // parser accident; another engine can drop the descriptor and fall back
    // to a system font for the whole Latin block. The fix is U+0001-00FF (NULL
    // is never rendered), asserted here against the BUILT bytes so the
    // minifier can never silently reintroduce it.
    const built = builtStylesheet();
    for (const range of built.match(/unicode-range:([^}]*)}/g) ?? []) {
      assert.doesNotMatch(
        range,
        /U\?\?/,
        "a unicode-range was mangled to U+?? by the minifier — the latin range " +
          "must start at U+0001, not U+0000",
      );
      assert.match(range, /unicode-range:U\+[0-9a-f]/i);
    }
    assert.equal(
      (built.match(/unicode-range:/g) ?? []).length,
      2,
      "both faces must still declare a range",
    );
  });

  test("the latin face covers basic Latin and the site's arrows", () => {
    const built = builtStylesheet();
    const latin =
      built.match(/unicode-range:([^}]*inter-latin[^}]*)}/) ??
      built.match(
        /inter-latin\.woff2\)format\("woff2"\);unicode-range:([^}]*)}/,
      );
    assert.ok(latin, "could not locate the latin face's unicode-range");
    const range = latin[1];
    assert.match(range, /U\+1-FF/, "the basic Latin block must be covered");
    assert.match(
      range,
      /U\+2192/,
      "the → arrows the site renders must be covered",
    );
  });

  test("the font files are emitted to dist", () => {
    assert.ok(existsSync(path.join(DIST, "fonts/inter-latin.woff2")));
    assert.ok(existsSync(path.join(DIST, "fonts/inter-latin-ext.woff2")));
    assert.ok(existsSync(path.join(DIST, "fonts/LICENSE.txt")));
  });

  test("no built asset reaches an external font host", () => {
    // check:dist deliberately treats absolute URLs as external and skips
    // them; a font CDN reference is exactly what this must catch.
    const files = [path.join(DIST, "index.html"), path.join(DIST, "_astro")];
    for (const target of files) {
      const text = readFileSync(
        existsSync(target) && target.endsWith(".html")
          ? target
          : readdirSync(target)
              .find((f) => f.endsWith(".css"))
              .replace(/^/, target + "/"),
        "utf8",
      );
      assert.doesNotMatch(text, /fonts\.(googleapis|gstatic)\.com/);
    }
  });
});

describe("the head preloads the face every page needs", () => {
  const layout = readFileSync(
    path.join(REPO_ROOT, "src/layouts/BaseLayout.astro"),
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
    const preloadBlock = layout.slice(
      layout.indexOf('rel="preload"'),
      layout.indexOf('rel="preload"') + 400,
    );
    assert.doesNotMatch(preloadBlock, /inter-latin-ext/);
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
  const tokens = readFileSync(
    path.join(REPO_ROOT, "src/styles/tokens.css"),
    "utf8",
  );

  test("--font-sans still names Inter first", () => {
    assert.match(
      tokens,
      /--font-sans:\s*Inter,\s*system-ui/,
      "ENG-102 locks the typography tokens — the stack must be unchanged",
    );
  });
});
