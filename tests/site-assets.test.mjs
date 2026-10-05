/**
 * Site asset integrity — the favicon.
 *
 * Why this exists: with no icon link in the head, browsers request
 * /favicon.ico themselves, and that request 404'd on every page load (found
 * by the ENG-86 baseline audit). `check:dist` already treats both icon hrefs
 * as internal references, so a *missing file* reds the build — but nothing
 * caught a *removed link tag*, which silently restores the 404. These cases
 * pin both halves: the declaration and the assets it points at.
 *
 * The .ico is generated from the same geometry as the SVG (a typographic
 * monogram, founder decision 2026-10-05), so its internal structure is
 * asserted rather than trusted: a malformed container would show as a broken
 * icon rather than a clean 404.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const layout = readFileSync(
  path.join(REPO_ROOT, "src/layouts/BaseLayout.astro"),
  "utf8",
);

describe("the head declares the site icon", () => {
  test("SVG monogram is the primary icon", () => {
    assert.match(
      layout,
      /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/,
    );
  });

  test("a legacy .ico fallback is declared too", () => {
    assert.match(layout, /<link rel="icon" href="\/favicon\.ico"/);
  });
});

describe("the icon assets exist and are well formed", () => {
  test("favicon.svg is an SVG with an intrinsic size", () => {
    const svg = readFileSync(
      path.join(REPO_ROOT, "public/favicon.svg"),
      "utf8",
    );
    assert.match(svg, /<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 64 64"/);
    assert.ok(existsSync(path.join(REPO_ROOT, "public/favicon.svg")));
  });

  test("the monogram uses the design-system colours, not new brand values", () => {
    const svg = readFileSync(
      path.join(REPO_ROOT, "public/favicon.svg"),
      "utf8",
    );
    // --color-tertiary and --color-neutral; an invented colour would be a
    // brand change, which is not this file's to make.
    assert.ok(svg.includes("#0f5b5a"), "ground must be --color-tertiary");
    assert.ok(svg.includes("#fafaf8"), "glyph must be --color-neutral");
  });

  test("favicon.ico is a valid multi-size ICO container", () => {
    const ico = readFileSync(path.join(REPO_ROOT, "public/favicon.ico"));
    assert.equal(ico.readUInt16LE(0), 0, "reserved field must be 0");
    assert.equal(ico.readUInt16LE(2), 1, "type 1 = icon");
    const count = ico.readUInt16LE(4);
    assert.ok(count >= 2, `expected at least two sizes, found ${count}`);

    const sizes = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + 16 * index;
      const width = ico.readUInt8(entry) || 256;
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      assert.ok(
        offset + bytes <= ico.length,
        `image ${index} points past the end of the file`,
      );
      sizes.push(width);
    }
    assert.ok(
      sizes.includes(16) && sizes.includes(32),
      `a favicon must offer 16px and 32px, found ${sizes.join(", ")}`,
    );
  });
});
