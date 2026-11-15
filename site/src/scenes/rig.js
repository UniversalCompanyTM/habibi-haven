/*
 * The clock reader for the 3D door scene.
 *
 * ARCHITECTURE.md rule 4: rig-client.mjs's applyHour() is the ONLY writer of
 * --hour/--night, and hours.mjs owns the night curve. This file therefore only
 * READS what the clock already committed to <html> — it must never recompute the
 * curve or carry a copy of a stop. Colours are sampled from computed custom
 * properties, which CSS has already interpolated with
 * `color-mix(in oklab, …, var(--night))`, so at any hour the WebGL scene sees the
 * exact same palette the CSS fallback paints. If a token ever disappears, the
 * fallbacks below are tripwires for the developer console, not design stops.
 */

const TOKENS = [
  ["bg0", "--bg-0"],
  ["bg1", "--bg-1"],
  ["bg2", "--bg-2"],
  ["bg3", "--bg-3"],
  ["tealDeep", "--teal-deep"],
  ["brass", "--brass"],
  ["brassSoft", "--brass-soft"],
  ["lampGlow", "--lamp-glow"],
  ["ivory", "--ivory"],
];

// Only used when getComputedStyle hands back nothing usable (SSR, detached node,
// a renamed token). Values mirror tokens.css at night because that is the frame
// the site ships its photographs from.
const FALLBACK = {
  bg0: [8, 26, 27],
  bg1: [11, 37, 35],
  bg2: [15, 47, 42],
  bg3: [22, 62, 52],
  tealDeep: [10, 107, 91],
  brass: [201, 162, 77],
  brassSoft: [232, 206, 148],
  lampGlow: [255, 196, 110],
  ivory: [246, 238, 223],
};

const NUMBER_PATTERN = /(-?\d*\.?\d+)/;
// Computed styles arrive either as space- or comma-separated channels, and some
// engines emit percentages instead of 0–255 bytes. The separator tells the two
// forms apart, so hoist one pattern instead of rebuilding it per token read.
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)(?:%|[, ])\s*([\d.]+)(?:%|[, ])\s*([\d.]+)/i;
const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
// An engine that resolves a `color-mix(in oklab, …)` may hand the colour back in a named space rather than
// rgb(), with channels as 0–1 floats. Same three numbers, different scale and spelling.
const COLOR_FN_PATTERN = /^color\(\s*(?:srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i;
// This is what Chrome actually answers for `color-mix(in oklab, …)`: the mix stays in Oklab and serialises
// as the function below, not as rgb(). Measured with the runtime harness's own --probe, on the shipped page.
const OKLAB_PATTERN = /^oklab\(\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/i;

// Oklab → linear sRGB → sRGB bytes, the published Björn Ottosson transform: undo the LMS cube roots, apply
// the LMS-to-linear-RGB matrix, then the sRGB transfer curve. Sign is carried through the curve because a
// mix that lands outside the gamut produces negative channels, and clamping before the curve would turn
// those into a different colour instead of a harder edge.
function oklabToBytes(l, a, b) {
  const fy = l + 0.3963377774 * a + 0.2158037573 * b;
  const fzy = l - 0.1055613458 * a - 0.0638541728 * b;
  const fz = l - 0.0894841775 * a - 1.291485548 * b;
  const x = fy ** 3;
  const y = fzy ** 3;
  const z = fz ** 3;
  const linear = [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
  return linear.map((u) => {
    const magnitude = Math.abs(u);
    const curved = u < 0 ? -1 : 1;
    const encoded = magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;
    return clamp(curved * encoded * 255, 0, 255);
  });
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function readNumber(style, property, fallback) {
  const raw = style.getPropertyValue(property);
  const match = raw && NUMBER_PATTERN.exec(raw);
  return match ? clamp(Number(match[1]), 0, 1) : fallback;
}

function parseColor(text) {
  if (!text) return null;
  let m = RGB_PATTERN.exec(text);
  if (m) {
    // The engine reports either 0–255 numbers or percentages; the separator tells them apart.
    const scale = text.indexOf("%") === -1 ? 1 : 2.55;
    return [
      clamp(Number(m[1]) / scale, 0, 255),
      clamp(Number(m[2]) / scale, 0, 255),
      clamp(Number(m[3]) / scale, 0, 255),
    ];
  }
  m = HEX_PATTERN.exec(text);
  if (m) {
    const hex = m[1];
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  m = COLOR_FN_PATTERN.exec(text);
  if (m) return [clamp(Number(m[1]) * 255, 0, 255), clamp(Number(m[2]) * 255, 0, 255), clamp(Number(m[3]) * 255, 0, 255)];
  m = OKLAB_PATTERN.exec(text);
  if (m) return oklabToBytes(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/*
 * A custom property's computed value is the text it was declared with, with var() references substituted but
 * nothing else evaluated: `--bg-2` comes back as "color-mix(in oklab, #ffffff, #0b2621 calc(0.097 * 100%))".
 * Reading that directly and looking for numbers finds none, so every surface token fell through to the night
 * fallbacks and the door kept its midnight palette while the clock moved the lights, the fog and the exposure
 * around it. The scene and the CSS are supposed to be the same picture, so the substitution has to be
 * completed the only way that is guaranteed to agree with the stylesheet: hand the expression to an element as
 * a colour and read the engine's own answer back. The probe is created once, kept off-layout, and never styled
 * with anything the page can see.
 */
let colourProbe = null;
const warnedAbout = new Set();

function resolveColour(text, fallback, property) {
  const direct = parseColor(text);
  if (direct) return direct;
  if (!text || typeof document === "undefined") return fallback;
  if (!colourProbe?.isConnected) {
    colourProbe = document.createElement("span");
    colourProbe.setAttribute("aria-hidden", "true");
    colourProbe.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none";
    document.documentElement.appendChild(colourProbe);
  }
  colourProbe.style.color = text;
  const computed = getComputedStyle(colourProbe).color;
  colourProbe.style.color = "";
  const resolved = parseColor(computed);
  if (!resolved && !warnedAbout.has(property)) {
    warnedAbout.add(property);
    console.warn(`hh:rig — ${property} did not resolve to a colour ("${text}"); the scene is using its fallback.`);
  }
  return resolved ?? fallback;
}

/**
 * Snapshot of the live palette, in 0–255 sRGB bytes. Called once at mount and
 * again on every hh:hour repaint — never per animation frame.
 */
export function readPalette(root = document.documentElement) {
  const style = getComputedStyle(root);
  const palette = {};
  for (const [name, property] of TOKENS) {
    const raw = style.getPropertyValue(property).trim();
    if (!raw && !warnedAbout.has(property)) {
      warnedAbout.add(property);
      console.warn(`hh:rig — ${property} is not declared, so the door is painting ${name} from its night fallback.`);
    }
    palette[name] = resolveColour(raw, FALLBACK[name], property);
  }
  return palette;
}

/**
 * Where the clock stands right now. Base.astro writes data-hour/data-night into
 * <body> at build time and applyHour() keeps them current, so this works before
 * any script has run and after every hour change alike. The defaults match
 * Base.astro's own static fallback (night, 19:00) so a missing attribute cannot
 * make the scene disagree with the CSS still.
 */
export function readClock(root = document.documentElement) {
  const style = getComputedStyle(root);
  const body = document.body;
  const nightRaw = style.getPropertyValue("--night").trim();
  const hourRaw = style.getPropertyValue("--hour").trim();
  const nightMatch = nightRaw && NUMBER_PATTERN.exec(nightRaw);
  const hourMatch = hourRaw && NUMBER_PATTERN.exec(hourRaw);
  const night = nightMatch ? clamp(Number(nightMatch[1]), 0, 1) : Number(body?.dataset.night ?? 1);
  const hour = hourMatch ? Number(hourMatch[1]) : Number(body?.dataset.hour ?? 19);
  return { hour, night: clamp(night, 0, 1) };
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Map the two numbers the clock publishes onto physical light settings.
 *
 * `night` is the clock's curve value; `open` comes from the hh:hour detail
 * (HoursClock knows whether the haven is serving). Everything here is a lighting
 * response, not a palette definition — the colours themselves stay in CSS.
 */
export function rigValues(night, open) {
  const n = clamp(night, 0, 1);
  // Lamps strike up across early dusk rather than snapping on at nightfall, so
  // the transition reads like someone reaching for a switch, not a blackout.
  const lamp = smoothstep(0.12, 0.72, n);
  // A closed courtyard keeps one lantern burning by the door but loses the
  // interior bounce — dimmer, emptier, same colour temperature.
  const openFactor = open === false ? 0.62 : 1;
  return {
    night: n,
    lamp,
    open: open !== false,
    lanternIntensity: (0.12 + 1.85 * lamp) * openFactor,
    // Daylight is the part of the curve that used to break the render: at 14:00 the street key, the sky
    // fill and the bounce summed past the plaster's albedo and ACES had nothing left to compress, so the
    // façade became a flat white field and the arch lost its edges. These three are the daytime ceiling —
    // still brightest in the morning, still a clear step down into the evening, but under the clip.
    streetIntensity: 0.78 * (1 - 0.86 * n),
    skyIntensity: 0.34 * (1 - 0.5 * n),
    bounceIntensity: 0.5 * (1 - 0.4 * n) * openFactor,
    // The three lantern lights hang near the door, and a directional light knows nothing about occlusion,
    // so past the second arch the courtyard had nothing to light it and read as a silhouette against the
    // façade. This is the warm fill that lives inside the run: never off, brighter once the lamps strike up,
    // and the difference between a black hole and a room you can see tables in.
    interiorFill: 0.3 + 1.25 * lamp,
    hazeOpacity: 0.05 + 0.3 * lamp,
    breathDepth: 0.035 + 0.085 * lamp,
    swayAmplitude: 0.016 + 0.012 * lamp,
    dustOpacity: (0.16 + 0.5 * lamp) * openFactor,
    exposure: 0.96 + 0.2 * n,
  };
}
