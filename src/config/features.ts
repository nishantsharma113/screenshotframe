// Feature switches, read at build time from env vars (.env.local, or the build environment).

/**
 * Billing and pricing: the landing page's pricing section, the header's Pricing/Billing links,
 * /account/billing and the "Upgrade"/"See plans" prompts. Hidden unless VITE_ENABLE_BILLING=true.
 * Plan checks themselves (feature gates, server-side limits) are not affected.
 */
export const BILLING_ENABLED = import.meta.env.VITE_ENABLE_BILLING === 'true';
