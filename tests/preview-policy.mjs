#!/usr/bin/env node
// Render the real page components through Astro's server runtime. This is not `astro build`: it
// exercises the shared layout and footer without producing dist or starting a browser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, test } from "node:test";

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");
const SITE = join(ROOT, "site");
const RESULT_PREFIX = "PREVIEW_POLICY_RESULT=";
const WARNING =
  "Private pitch preview — not Habibi Haven’s official website. Media rights remain with their respective rights holders; reuse and redistribution permission is unconfirmed. For evaluation only; do not publish or redistribute.";
const ROUTES = {
  "/": "index.astro",
  "/menu": "menu.astro",
  "/table": "table.astro",
  "/visit": "visit.astro",
  "/404": "404.astro",
};
const UNCONFIRMED_CLAIMS = [
  "Site built for the business.",
  "Photographs belong to the restaurant",
  "permission granted",
  "used with permission",
];

if (process.env.HH_PREVIEW_POLICY_CHILD === "1") {
  await renderPages(process.env.HH_PREVIEW_POLICY_MODE);
} else {
  let privatePages;
  let publicPages;

  before(() => {
    privatePages = renderInChild("private");
    publicPages = renderInChild("public");
  });

  test("default/private mode renders noindex, nofollow on every page", () => {
    for (const page of privatePages) {
      assert.deepEqual(
        page.robots,
        [{ name: "robots", content: "noindex, nofollow" }],
        `${page.route} must ship exactly one private robots directive`,
      );
    }
  });

  test("explicit PUBLIC_INDEXABLE=true renders no robots meta on any page", () => {
    for (const page of publicPages) {
      assert.deepEqual(page.robots, [], `${page.route} must not ship a robots meta in an explicitly indexable build`);
    }
  });

  test("every page renders the exact private-preview and rights warning in a visible footer element", () => {
    for (const page of privatePages) {
      assert.equal(page.warningCount, 1, `${page.route} must carry the warning once in its footer`);
      assert.equal(page.warningVisible, true, `${page.route} must not hide the warning from visitors or assistive technology`);
    }
  });

  test("the footer does not imply official approval or media permission that remains unconfirmed", () => {
    for (const page of privatePages) {
      assert.deepEqual(page.unconfirmedClaims, [], `${page.route} must not claim rights or approval still open`);
    }
  });
}

function renderInChild(mode) {
  const env = { ...process.env, HH_PREVIEW_POLICY_CHILD: "1", HH_PREVIEW_POLICY_MODE: mode };
  if (mode === "public") env.PUBLIC_INDEXABLE = "true";
  else delete env.PUBLIC_INDEXABLE;

  const run = spawnSync(process.execPath, [SELF], {
    cwd: SITE,
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.error) throw run.error;
  assert.equal(run.status, 0, `${mode} render failed:\n${output}`);
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(RESULT_PREFIX));
  assert.ok(line, `${mode} render returned no policy result:\n${output}`);
  return JSON.parse(line.slice(RESULT_PREFIX.length)).pages;
}

async function renderPages(mode) {
  const requireFromSite = createRequire(new URL("../site/package.json", import.meta.url));
  const { createServer } = await import(pathToFileURL(requireFromSite.resolve("vite")).href);
  const { getViteConfig } = await import(pathToFileURL(requireFromSite.resolve("astro/config")).href);
  const { experimental_AstroContainer: AstroContainer } = await import(pathToFileURL(requireFromSite.resolve("astro/container")).href);
  const astroConfig = (await import(new URL("../site/astro.config.mjs", import.meta.url).href)).default;
  const config = await getViteConfig(
    {
      ...astroConfig.vite,
      root: SITE,
      configFile: false,
      server: { middlewareMode: true, watch: null },
      appType: "custom",
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
    },
    { ...astroConfig, root: SITE },
  )({ mode: "development", command: "serve" });
  const server = await createServer(config);

  try {
    const container = await AstroContainer.create();
    const pages = [];
    for (const [route, file] of Object.entries(ROUTES)) {
      const { default: Page } = await server.ssrLoadModule(`/src/pages/${file}`);
      const html = await container.renderToString(Page, {
        partial: false,
        request: new Request(new URL(route, astroConfig.site)),
        props: {},
      });
      const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
      const robots = [...head.matchAll(/<meta\b[^>]*>/gi)]
        .map((match) => ({ name: attribute(match[0], "name"), content: attribute(match[0], "content") }))
        .filter((meta) => meta.name?.toLowerCase() === "robots");
      const footerTag = html.match(/<footer\b([^>]*)>([\s\S]*?)<\/footer>/i);
      const footerAttributes = footerTag?.[1] ?? "";
      const footer = footerTag?.[2] ?? "";
      const footerText = textOf(footer);
      const warningElement = elementWithExactText(footer, WARNING);
      pages.push({
        route,
        robots,
        warningCount: footerText.split(WARNING).length - 1,
        warningVisible:
          warningElement !== undefined &&
          !hidden(footerAttributes) &&
          !hidden(warningElement[2]),
        unconfirmedClaims: UNCONFIRMED_CLAIMS.filter((claim) => footerText.includes(claim)),
      });
    }
    console.log(`${RESULT_PREFIX}${JSON.stringify({ mode, pages })}`);
  } finally {
    await server.close();
  }
  // Vite's dependency optimizer can leave a worker alive after close(); this child has no other work.
  process.exit(0);
}

function elementWithExactText(html, wanted) {
  for (const match of html.matchAll(/<(p|span|div|li)\b([^>]*)>/gi)) {
    const start = match.index + match[0].length;
    const end = html.indexOf(`</${match[1]}>`, start);
    if (end !== -1 && textOf(html.slice(start, end)) === wanted) return match;
  }
  return undefined;
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function hidden(attributes) {
  return (
    /\bhidden(?:\s|=|$)/i.test(attributes) ||
    /\baria-hidden\s*=\s*["']true["']/i.test(attributes) ||
    /\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes)
  );
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(text) {
  return text
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
