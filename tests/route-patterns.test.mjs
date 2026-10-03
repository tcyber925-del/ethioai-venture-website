/**
 * Regression suite for the pure route-matching helpers.
 *
 * Run: node --test
 *
 * These cases encode the behavior agreed across PR #7 review rounds
 * (round-2/3 regression lists): literal pages, dynamic `[param]` segments,
 * rest `[...param]` segments (including root-level and parent-path matches),
 * query/hash normalization and external-reference classification. Keep them
 * in sync when changing `src/config/route-patterns.ts`.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  filePattern,
  isInternalSitePath,
  normalizeRoutePath,
  routeMatchesFile,
  segmentPattern,
} from "../src/config/route-patterns.ts";

describe("normalizeRoutePath", () => {
  const cases = [
    ["/work", "work"],
    ["/work/", "work"],
    ["/work?tab=1#top", "work"],
    ["/", ""],
    ["", ""],
    ["#anchor", ""],
    ["/solutions/workflow-automation", "solutions/workflow-automation"],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → "${expected}"`, () => {
      assert.equal(normalizeRoutePath(input), expected);
    });
  }
});

describe("isInternalSitePath", () => {
  const cases = [
    ["/work", true],
    ["/", true],
    ["/solutions/x?y", true],
    ["//cdn.example.com/x", false],
    ["https://example.com", false],
    ["mailto:hi@example.com", false],
    ["tel:+25111", false],
    ["#anchor", false],
    ["", false],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      assert.equal(isInternalSitePath(input), expected);
    });
  }
});

describe("segmentPattern", () => {
  test("dynamic segment matches any single segment", () => {
    assert.match("ethiobio", new RegExp(`^${segmentPattern("[project]")}$`));
    assert.doesNotMatch("a/b", new RegExp(`^${segmentPattern("[project]")}$`));
  });
  test("literal segment is regex-escaped", () => {
    assert.match("a.b", new RegExp(`^${segmentPattern("a.b")}$`));
    assert.doesNotMatch("axb", new RegExp(`^${segmentPattern("a.b")}$`));
  });
});

describe("filePattern / routeMatchesFile", () => {
  const cases = [
    // literal pages
    ["index", "index", true],
    ["about", "about", true],
    ["start-a-project", "start-a-project", true],
    ["solutions/index", "solutions", false], // index covered by candidates
    // dynamic detail routes (PRs #8/#10/#11 shapes)
    ["work/[project]", "work/ethiobio", true],
    ["work/[project]", "work", false],
    ["work/[project]", "work/a/b", false],
    ["research/[slug]", "research/my-note", true],
    ["solutions/[slug]", "solutions/workflow-automation", true],
    // rest routes
    ["docs/[...slug]", "docs", true],
    ["docs/[...slug]", "docs/a/b", true],
    ["[...slug]", "anything", true],
    // grouping must not leak
    ["a.b/c", "a.b/c", true],
    ["a.b/c", "axb/c", false],
  ];
  for (const [file, path, expected] of cases) {
    test(`${file} vs ${path} → ${expected}`, () => {
      assert.equal(routeMatchesFile(path, file), expected);
      assert.equal(filePattern(file).test(path), expected);
    });
  }
});
