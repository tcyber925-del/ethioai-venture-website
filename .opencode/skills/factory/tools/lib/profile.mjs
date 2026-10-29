// pack/tools/lib/profile.mjs
//
// The profile's `protected_paths`, read from `.factory/profile.md`.
//
// The profile on disk is Markdown with `## <field>` sections. Only one field
// is read here -- `protected_paths` -- because it is the one the transition
// gate enforces. The section is a Markdown bullet list, one repository-relative
// glob per bullet, or the single word `none`. The EFFECTIVE policy always
// adds the floor below; `none` protects no application path, never the policy
// files themselves:
//
//   ## protected_paths
//   - `src/payments/**`
//   - infra/
//
// The grammar is deliberately narrow. Prose is NOT an empty policy: an
// operator who writes `src/payments/**` without a bullet meant to protect
// that path, and reading it as "nothing" would silently disable the gate.
// A bullet is one bare glob -- whitespace, a stray backtick, negation and
// absolute paths are refused rather than guessed at. A missing file, a missing
// section, an empty section and an unparseable bullet are all unreadable
// configuration -- the caller reports `inconclusive`, never a permit.
//
// A glob is matched against the repository-relative paths git reports:
//
//   `**`  zero or more path segments
//   `*`   zero or more characters within one segment
//   `?`   one character within one segment
//   `dir/` is `dir/**`
//   a pattern with no slash matches at any depth (`*.pem` is `**/*.pem`)
//   a leading `/` or `./` anchors the pattern to the repository root
//
// Matching is case-sensitive, as git paths are on the platforms this pack
// supports.
import { join } from "node:path";
import { readText } from "./job-folder.mjs";

/** The profile's location, relative to the repository root. */
export const PROFILE_REL = ".factory/profile.md";

/**
 * The paths every job protects, whatever the profile says.
 *
 * The profile is the policy, so the profile and the policy directory cannot be
 * ordinary editable paths: a job that could rewrite them could authorise its
 * own change. The floor is part of the EFFECTIVE policy, not a default an
 * operator can switch off -- `protected_paths: none` protects no application
 * path, and still protects these.
 */
export const POLICY_FLOOR = Object.freeze([
  PROFILE_REL,
  ".factory/policies/**",
]);

/**
 * A profile's own patterns plus the floor, as the job binds and compares them.
 *
 * The floor is applied here, at the policy boundary, so every caller sees the
 * same effective list: the claim that writes the binding and every later
 * check that compares against it. A pattern the operator also wrote is one
 * protection, not two.
 */
export function effectiveProtectedPaths(patterns) {
  return [...new Set([...patterns, ...POLICY_FLOOR])].sort();
}

/**
 * The body of one `## <field>` section.
 *
 * A deeper heading is structure inside the section: its line stays in the
 * body, so a parser can refuse it rather than mistake a sub-list for the
 * field's own list. Two sections with the same name are ambiguous, not
 * merged.
 */
export function profileSection(markdown, name) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const bodies = [];
  let current = null;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (heading[1].length <= 2) {
        current = heading[2] === name ? [] : null;
        if (current) bodies.push(current);
      } else if (current) {
        current.push(line);
      }
      continue;
    }
    if (current) current.push(line);
  }
  if (bodies.length === 0) {
    return { ok: false, reason: `the profile has no \`## ${name}\` section` };
  }
  if (bodies.length > 1) {
    return { ok: false, reason: `the profile has ${bodies.length} \`## ${name}\` sections` };
  }
  return { ok: true, body: bodies[0].join("\n").trim() };
}

/** Why a pattern cannot be read as a repository-relative glob, or null. */
function invalidPattern(pattern) {
  if (pattern.length === 0) return "a bullet is empty";
  if (pattern.includes("\0")) return "a pattern contains a NUL byte";
  if (pattern.startsWith("!")) return "negation is not supported";
  if (pattern.includes("\\")) return "a pattern must use `/`, not `\\`";
  if (pattern.includes("`")) return "a pattern must not contain a backtick";
  if (/\s/.test(pattern)) return "a pattern must not contain whitespace -- one bare glob per bullet";
  if (/^[A-Za-z]:\//.test(pattern)) return "a pattern must be repository-relative";
  if (pattern.startsWith("~")) return "a pattern must be repository-relative";
  let body = pattern;
  if (body.startsWith("./")) body = body.slice(2);
  else if (body.startsWith("/")) body = body.slice(1);
  if (body.endsWith("/")) body = body.slice(0, -1);
  if (body.length === 0) return "a pattern names no path";
  const segments = body.split("/");
  if (segments.includes("..")) return "a pattern must not leave the repository";
  if (segments.includes(".")) return "a pattern must not contain `.` segments";
  if (segments.includes("")) return "a pattern must not contain an empty segment";
  return null;
}

/** Strip one matching pair of backticks or quotes around a bullet's value. */
function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "`" && last === "`") || (first === '"' && last === '"') ||
      (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * The patterns in a `protected_paths` section body.
 *
 * `none` is the only way to say "nothing is protected", and it stands alone.
 * HTML comments are ignored, so the template can explain the syntax without
 * becoming part of the policy.
 */
export function parseProtectedPaths(body) {
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "");
  const lines = stripped.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return { ok: false, reason: "the `protected_paths` section is empty" };
  if (lines.length === 1 && /^none\.?$/i.test(lines[0])) return { ok: true, patterns: [] };

  const patterns = [];
  for (const line of lines) {
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (!bullet) {
      return {
        ok: false,
        reason: `\`${line}\` is not a bullet -- write one \`- <glob>\` per line, or \`none\``,
      };
    }
    const pattern = unquote(bullet[1].trim());
    const invalid = invalidPattern(pattern);
    if (invalid) return { ok: false, reason: `\`${pattern}\`: ${invalid}` };
    patterns.push(pattern);
  }
  return { ok: true, patterns };
}

/**
 * Read `.factory/profile.md`'s own `protected_paths`, or why it cannot be read.
 *
 * This is the operator's list, not the effective policy: the floor is added by
 * `effectiveProtectedPaths`, which every binding and comparison uses.
 */
export function readProtectedPaths(repoRoot) {
  const path = join(repoRoot, PROFILE_REL);
  const read = readText(path);
  if (!read.ok) {
    return {
      ok: false,
      reason: read.kind === "missing"
        ? `\`${PROFILE_REL}\` does not exist`
        : `\`${PROFILE_REL}\` cannot be read (${read.reason})`,
    };
  }
  const section = profileSection(read.text, "protected_paths");
  if (!section.ok) return section;
  return parseProtectedPaths(section.body);
}

/** The pattern's segments, with the documented shorthands applied. */
function patternSegments(pattern) {
  let body = pattern.trim();
  let anchored = false;
  if (body.startsWith("./")) {
    body = body.slice(2);
    anchored = true;
  } else if (body.startsWith("/")) {
    body = body.slice(1);
    anchored = true;
  }
  if (body.endsWith("/")) body = `${body}**`;
  if (!anchored && !body.includes("/")) body = `**/${body}`;
  return body.split("/");
}

/** Does one path segment match one glob segment? */
function segmentMatches(glob, segment) {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(segment);
}

function matchSegments(glob, gi, path, pi) {
  if (gi === glob.length) return pi === path.length;
  if (glob[gi] === "**") {
    if (matchSegments(glob, gi + 1, path, pi)) return true;
    return pi < path.length && matchSegments(glob, gi, path, pi + 1);
  }
  if (pi === path.length) return false;
  return segmentMatches(glob[gi], path[pi]) && matchSegments(glob, gi + 1, path, pi + 1);
}

/**
 * Does `path` fall under `pattern`?
 *
 * An invalid pattern matches nothing. The caller never reaches that state:
 * `parseProtectedPaths` refuses invalid patterns first, so a malformed policy
 * is an inconclusive gate rather than a silent miss.
 */
export function matchesProtectedPath(pattern, path) {
  if (invalidPattern(pattern)) return false;
  const glob = patternSegments(pattern);
  const parts = path.split("/");
  return matchSegments(glob, 0, parts, 0);
}

/**
 * The policy a job's claim takes: the effective protected paths, as parsed,
 * sorted so the same list reached by different orders compares equal.
 *
 * The effective list includes the implicit floor, so a profile of `none`
 * still binds `.factory/profile.md` and `.factory/policies/**`.
 *
 * The tool writes this when a job is claimed, and the transition writer and
 * the handoff compare it with the profile on disk again. A policy that moved
 * after that is not the job's policy, and an inconclusive answer never lets a
 * job through.
 */
export function policyBinding(repoRoot) {
  const config = readProtectedPaths(repoRoot);
  if (!config.ok) {
    return { ok: false, reason: config.reason };
  }
  return {
    ok: true,
    policy: {
      protected_paths: effectiveProtectedPaths(config.patterns),
      pinned_at: new Date().toISOString(),
    },
  };
}

/**
 * One pattern, in the form the matcher actually applies.
 *
 * `./src/payments/**`, `/src/payments/**` and `src/payments/` all become
 * `src/payments/**`. An invalid pattern is kept apart rather than normalised
 * into something that could accidentally compare equal to a valid one: a
 * malformed binding is drift, not a permit.
 */
function canonicalPattern(pattern) {
  if (typeof pattern !== "string") return `invalid:${JSON.stringify(pattern)}`;
  if (invalidPattern(pattern)) return `invalid:${pattern}`;
  return patternSegments(pattern).join("/");
}

/**
 * Do two effective-policy lists name the same protection?
 *
 * Comparing raw strings made a job inconclusive when an operator rewrote
 * `src/payments/**` as `./src/payments/**` or `src/payments/` -- the same
 * protection, refused as drift. The comparison is therefore against the
 * canonical pattern the matcher applies, and duplicates are one policy.
 */
export function samePolicy(pinned, live) {
  const canon = (patterns) => [...new Set(patterns.map(canonicalPattern))].sort();
  const a = canon(pinned);
  const b = canon(live);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Check a job's pinned policy against the profile on disk.
 *
 * The first argument is the job record's `policy` object, as the claim wrote
 * it. The second is the repository root whose `.factory/profile.md` is read.
 *
 *   - no `policy` on the record       -> no permit; the job never claimed, or
 *                                       was claimed before bindings existed
 *   - unreadable profile               -> inconclusive, never a permit
 *   - a list that moved               -> inconclusive, never a permit
 *   - the same list                   -> the job may be judged by it
 *
 * Every failure is a value: the caller reports it as undecidable, never as a
 * permit.
 */
export function checkPolicyBinding(policy, repoRoot) {
  const live = readProtectedPaths(repoRoot);
  if (!live.ok) {
    // The profile is read before the binding is judged, so a job whose policy
    // cannot be read is answered with the policy's own unavailability, not
    // with the shape of the binding that would have carried it.
    return { ok: false, reason: live.reason };
  }
  if (!policy || typeof policy !== "object" || !Array.isArray(policy.protected_paths)) {
    return {
      ok: false,
      reason: "the record carries no policy binding, so the job cannot be judged: " +
        "it was either never claimed, or claimed before policy binding was introduced. " +
        "A running job may not re-pin its policy; a new job is required to bind the current policy",
    };
  }
  // The live side carries the floor too. Comparing only the profile's bullets
  // would let a binding written before the floor existed look current, and the
  // job would be judged by a policy that omits the policy files themselves.
  const current = effectiveProtectedPaths(live.patterns);
  if (!samePolicy(policy.protected_paths, current)) {
    const pinned = [...policy.protected_paths].sort();
    const fmt = (list) => (list.length > 0 ? list.join(", ") : "nothing");
    return {
      ok: false,
      reason: `the profile's \`protected_paths\` changed after the job was claimed (pinned [${fmt(pinned)}], now [${fmt(current)}])`,
    };
  }
  return { ok: true, patterns: policy.protected_paths };
}
