/**
 * Global site configuration — approved identity strings only.
 * Sources: MIS v1.0 "Product contract" (name/proposition) and
 * "V1 routes" + spec 02 primary navigation (Solutions · Work · Research ·
 * About · Start a Project). Do not add unapproved identity or contact claims.
 */
export const site = {
  name: "EthioAI Venture",
  description: "Practical AI systems for real-world organizations",
  /**
   * Absolute base URL of the deployed site (ENG-84 SEO: canonical URLs,
   * Open Graph, sitemap and robots.txt all derive from this one constant;
   * astro.config.mjs imports it as Astro's `site`). Founder decision
   * 2026-10-04: V1 hosts on Cloudflare Workers static assets under the
   * `.workers.dev` domain until a custom domain is attached — Cloudflare has
   * migrated Pages into Workers (wrangler 4.147), so the previously planned
   * `ethioai-venture-website.pages.dev` does not resolve; the ENG-88 baseline
   * deploy is live and verified at the value below. Swapping in a custom
   * domain later remains a one-line change here.
   *
   * Constraint: origin form only — NO trailing slash. Every consumer
   * concatenates a leading-slash path (`${site.url}/about/`), so a
   * trailing slash would emit `//about/` double slashes in sitemap `<loc>`
   * values and `Sitemap:` in robots.txt — and check:seo reds it (the
   * URL-built canonical no longer equals the concatenated expected form,
   * and og:url falls out of the site base).
   */
  url: "https://ethioai-venture-website.tcyber925.workers.dev",
} as const;

/** Approved primary navigation (spec 02 / MIS V1 routes). */
export const primaryNav = [
  { label: "Solutions", href: "/solutions" },
  { label: "Work", href: "/work" },
  { label: "Research", href: "/research" },
  { label: "About", href: "/about" },
  { label: "Start a Project", href: "/start-a-project" },
] as const;
