/**
 * /sitemap.xml (ENG-84) — static endpoint, dependency-free (no
 * @astrojs/sitemap: the route inventory is small and derivable, so a
 * generated XML file keeps the AGENTS.md "avoid unnecessary dependencies"
 * rule intact).
 *
 * Route inventory stays honest by derivation, not duplication:
 * - static routes come from the approved primary navigation
 *   (src/config/site.ts) plus home — this includes /start-a-project, which
 *   is a V1 route per the PRD and ships with ENG-83;
 * - detail routes come from the same content collections the pages'
 *   getStaticPaths read, so a sitemap entry can never outlive its page
 *   (except the intentionally listed /start-a-project until ENG-83 lands).
 *
 * URL form: trailing-slash directory URLs, matching Cloudflare Pages'
 * `auto-trailing-slash` canonical form (see BaseLayout's canonical logic).
 */
import { getCollection } from "astro:content";
import { site, primaryNav } from "../config/site";

/** Minimal XML text escape for URL content (slugs are [a-z0-9-] today). */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function GET(): Promise<Response> {
  const staticPaths = ["/", ...primaryNav.map(({ href }) => href)];
  const [solutions, projects, research] = await Promise.all([
    getCollection("solutions"),
    getCollection("projects"),
    getCollection("research"),
  ]);
  const detailPaths = [
    ...solutions.map((entry) => `/solutions/${entry.data.slug}`),
    ...projects.map((entry) => `/work/${entry.data.slug}`),
    ...research.map((entry) => `/research/${entry.data.slug}`),
  ];

  const urls = [...staticPaths, ...detailPaths].map((path) => {
    const withSlash = path.endsWith("/") ? path : `${path}/`;
    return `  <url><loc>${escapeXml(`${site.url}${withSlash}`)}</loc></url>`;
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
