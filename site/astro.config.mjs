// @ts-check
import { defineConfig } from "astro/config";

// Static output, per the approved decision 8 — the restaurant's system of record is menu.or.ke, and
// the site ships a validated snapshot of it rather than coupling a visitor to their database.
export default defineConfig({
  output: "static",
  site: "https://habibi-haven.netlify.app",
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
