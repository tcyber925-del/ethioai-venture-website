/**
 * Build-time route registry.
 *
 * The site shell (ENG-77) lands before the G2 pages exist. To avoid shipping
 * dead links (review requirement from PR #3), nav/footer items render as
 * plain text until the page module exists under src/pages; they become links
 * automatically when the route's page is added (G2/G3). Home always exists.
 *
 * Matching rules (ENG-78 reviews — dynamic-segment awareness):
 * - literal files: `start-a-project.astro`, `solutions/index.astro`
 * - dynamic route files: `work/[project].astro` matches `work/ethiobio`,
 *   because G2 detail pages are built with `getStaticPaths`
 * - a rest segment (`docs/[...slug]`) matches its parent path too (`docs`)
 * - `?query` and `#hash` suffixes are ignored when matching
 *
 * Contracts for callers (shared with Header.astro / Footer.astro):
 * - A collection route (`/work/...`, `/solutions/...`) activates only when a
 *   matching file exists — build slugs from the same `src/content`
 *   collection the detail page reads (homepage cards do), or a slug outside
 *   the collection could render as a live link whose page is never emitted.
 *   File shape is checked; `getStaticPaths` output is not visible at build
 *   time from here.
 * - A nav index route (`/work`, `/solutions`, …) needs its index page
 *   (`work/index.astro`); dynamic children do not imply it. Every open G2
 *   PR ships one (PRs #8 and #10).
 */
const pageModules = import.meta.glob("../pages/**/*.astro");

/** One path segment → regex source: `[param]` matches any single segment,
 * literals are regex-escaped. Rest segments are handled by `filePattern`. */
function segmentPattern(segment: string): string {
  if (segment.startsWith("[")) return "[^/]+";
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Page file path → full-route regex. A `[...param]` segment makes the
 * preceding separator and everything after optional, so
 * `docs/[...slug].astro` matches both `docs` and `docs/a/b`. */
function filePattern(file: string): RegExp {
  let pattern = "";
  for (const segment of file.split("/")) {
    if (segment.startsWith("[...")) {
      pattern += "(?:/.+)?";
    } else {
      pattern += (pattern === "" ? "" : "/") + segmentPattern(segment);
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Whether a route resolves to an existing page module at build time. */
export function routeExists(route: string): boolean {
  const path = route.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
  if (path === "") return true;
  const candidates = [`../pages/${path}.astro`, `../pages/${path}/index.astro`];
  if (candidates.some((candidate) => candidate in pageModules)) return true;
  return Object.keys(pageModules).some((key) => {
    const file = key.replace(/^\.\.\/pages\//, "").replace(/\.astro$/, "");
    return filePattern(file).test(path);
  });
}
