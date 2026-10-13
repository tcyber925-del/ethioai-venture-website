/**
 * Pure route-matching helpers for the build-time route registry
 * (`config/routes.ts`), split out so they carry no Vite APIs (`import.meta
 * .glob`) and can be exercised directly:
 *
 *   node --test
 *
 * (native TypeScript stripping — no dependencies, no loaders). The test
 * runner is not wired into `npm run verify` yet because that wiring lives in
 * `package.json`/CI, which PR #12 (ENG-87 quality gates) owns; the suite is
 * ready for it.
 *
 * Semantics and caller contracts are documented in `config/routes.ts`.
 */

/**
 * Whether a reference points at a site-internal path: a single leading slash
 * (not `//host` protocol-relative). External URLs, `mailto:`, `tel:` and
 * `#anchors` have no page module to existence-check — callers render them
 * as-is, so they are not part of the registry.
 */
export function isInternalSitePath(ref: string): boolean {
  return ref.startsWith("/") && !ref.startsWith("//");
}

/**
 * Normalize a route for matching: drop `?query`/`#hash`, then the leading
 * and trailing slash. `"/work?x=1#y"` → `"work"`, `"/"` → `""`.
 */
export function normalizeRoutePath(route: string): string {
  return route.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
}

/**
 * One path segment → regex source: `[param]` matches any single segment,
 * literals are regex-escaped. Rest segments are handled by `filePattern`.
 */
export function segmentPattern(segment: string): string {
  if (segment.startsWith("[")) return "[^/]+";
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Page file path → full-route regex. A `[...param]` segment makes the
 * preceding separator and everything after optional, so
 * `docs/[...slug].astro` matches both `docs` and `docs/a/b`; a rest at the
 * root (`[...slug].astro`) matches any path (`^.*$`).
 */
export function filePattern(file: string): RegExp {
  let pattern = "";
  for (const segment of file.split("/")) {
    if (segment.startsWith("[...")) {
      // Root rest must match any path (paths never carry the leading slash
      // that `(?:/.+)?` would require); after a literal segment it makes the
      // separator and tail optional.
      pattern += pattern === "" ? ".*" : "(?:/.+)?";
    } else {
      pattern += (pattern === "" ? "" : "/") + segmentPattern(segment);
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Whether an already-normalized path is served by a page file path — a key
 * of the pages glob (every `.astro` module under `../pages/`), minus the
 * `../pages/` prefix and `.astro` suffix.
 */
export function routeMatchesFile(path: string, file: string): boolean {
  return filePattern(file).test(path);
}

/**
 * ENG-103 � whether a navigation link points at the page currently being
 * viewed, for `aria-current="page"`.
 *
 * The rule: a nav link is current on its own path AND on that path's
 * descendants, so `/work` is current on `/work` and on `/work/ethioscident`,
 * but NOT on a sibling that merely shares a prefix (`/workshop`). Query and
 * hash are ignored. The root link (`/`) is current only on `/` itself �
 * otherwise every page would mark "Home" as current.
 *
 * Kept pure and dependency-free (no Vite APIs) so it can be exercised
 * directly by `node --test`, the same split as the rest of this module.
 * Callers pass the build-time pathname (`Astro.url.pathname`); a trailing
 * slash or a `?query`/`#hash` suffix does not change the verdict.
 */
export function isCurrentNavHref(
  navHref: string,
  currentPath: string,
): boolean {
  const nav = normalizeRoutePath(navHref);
  const current = normalizeRoutePath(currentPath);
  if (nav === current) return true;
  return nav !== "" && current.startsWith(`${nav}/`);
}
