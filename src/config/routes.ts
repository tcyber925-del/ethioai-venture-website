/**
 * Build-time route registry.
 *
 * The site shell (ENG-77) lands before the G2 pages exist. To avoid shipping
 * dead links (review requirement from PR #3), nav/footer items render as
 * plain text until the page module exists under src/pages; they become links
 * automatically when the route's page is added (G2/G3). Home always exists.
 *
 * Matching rules (ENG-78 review finding — dynamic-segment awareness):
 * - literal files: `start-a-project.astro`, `solutions/index.astro`
 * - dynamic route files: `work/[project].astro` matches `work/ethiobio`,
 *   because G2 detail pages are built with `getStaticPaths`
 * - `?query` and `#hash` suffixes are ignored when matching
 */
const pageModules = import.meta.glob("../pages/**/*.astro");

/** One path segment → regex source: `[param]` matches any single segment,
 * `[...param]` matches one or more, literals are regex-escaped. */
function segmentPattern(segment: string): string {
  if (segment.startsWith("[...")) return ".+";
  if (segment.startsWith("[")) return "[^/]+";
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a route resolves to an existing page module at build time. */
export function routeExists(route: string): boolean {
  const path = route.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
  if (path === "") return true;
  const candidates = [`../pages/${path}.astro`, `../pages/${path}/index.astro`];
  if (candidates.some((candidate) => candidate in pageModules)) return true;
  // Dynamic route files match any concrete path with the same segments.
  return Object.keys(pageModules).some((key) => {
    const file = key.replace(/^\.\.\/pages\//, "").replace(/\.astro$/, "");
    const pattern = new RegExp(
      `^${file.split("/").map(segmentPattern).join("/")}$`,
    );
    return pattern.test(path);
  });
}
