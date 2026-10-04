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
   * 2026-10-04: V1 hosts on Cloudflare Pages under the `.pages.dev` domain
   * until a custom domain is purchased — swapping the domain later is a
   * one-line change here.
   */
  url: "https://ethioai-venture-website.pages.dev",
} as const;

/** Approved primary navigation (spec 02 / MIS V1 routes). */
export const primaryNav = [
  { label: "Solutions", href: "/solutions" },
  { label: "Work", href: "/work" },
  { label: "Research", href: "/research" },
  { label: "About", href: "/about" },
  { label: "Start a Project", href: "/start-a-project" },
] as const;
