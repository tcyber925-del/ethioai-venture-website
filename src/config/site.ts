/**
 * Global site configuration — approved identity strings only.
 * Sources: MIS v1.0 "Product contract" (name/proposition) and
 * "V1 routes" + spec 02 primary navigation (Solutions · Work · Research ·
 * About · Start a Project). Do not add unapproved identity or contact claims.
 */
export const site = {
  name: "EthioAI Venture",
  description: "Practical AI systems for real-world organizations",
} as const;

/** Approved primary navigation (spec 02 / MIS V1 routes). */
export const primaryNav = [
  { label: "Solutions", href: "/solutions" },
  { label: "Work", href: "/work" },
  { label: "Research", href: "/research" },
  { label: "About", href: "/about" },
  { label: "Start a Project", href: "/start-a-project" },
] as const;
