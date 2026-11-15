// @ts-check
import { defineConfig } from "astro/config";

// Static output, per the approved decision 8 — the restaurant's system of record is menu.or.ke, and
// the site ships a validated snapshot of it rather than coupling a visitor to their database.
//
// `site` is the origin that canonical, og:url and the WhatsApp handoff link are all built from, so it is
// the one value that has to agree with wherever the bytes are actually served. The default is the private
// Cloudflare Pages preview; when the restaurant takes a domain it becomes a SITE_URL in CI instead of an
// edit here, and scripts/verify-dist.mjs fails any build whose HTML still points at a host nobody
// deployed to — a stale origin is a link to nowhere that reaches the kitchen, not a cosmetic slip.
const SITE = process.env.SITE_URL ?? "https://habibihavenpreview.pages.dev";

export default defineConfig({
  output: "static",
  site: SITE,
  trailingSlash: "never",
  build: { inlineStylesheets: "auto" },
  // No experimental flags: `env` was valid in an earlier 5.x and 5.18 rejects the key outright, which
  // is a build failure rather than a warning. The one public value the site needs is injected below
  // with `define`, so nothing depends on an experiment being on.
  //
  // PUBLIC_INDEXABLE=false (the default for the private preview) puts noindex on every page and is
  // re-asserted by scripts/verify-dist.mjs, because "preview" is a promise, not a setting you can
  // forget. Flip it to true only when the restaurant has signed off.
  vite: {
    define: {
      "import.meta.env.PUBLIC_INDEXABLE": JSON.stringify(process.env.PUBLIC_INDEXABLE ?? "false"),
    },
  },
});
