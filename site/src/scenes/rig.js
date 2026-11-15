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

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function readNumber(style, property, fallback) {
  const raw = style.getPropertyValue(property);
  const match = raw && NUMBER_PATTERN.exec(raw);
  return match ? clamp(Number(match[1]), 0, 1) : fallback;
}

function readCssColor(text, fallback) {
  if (!text) return fallback;
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
  return fallback;
}

/**
 * Snapshot of the live palette, in 0–255 sRGB bytes. Called once at mount and
 * again on every hh:hour repaint — never per animation frame.
 */
export function readPalette(root = document.documentElement) {
  const style = getComputedStyle(root);
  const palette = {};
  for (const [name, property] of TOKENS) {
    palette[name] = readCssColor(style.getPropertyValue(property).trim(), FALLBACK[name]);
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
    streetIntensity: 1.35 * (1 - 0.86 * n),
    skyIntensity: 0.5 * (1 - 0.55 * n),
    bounceIntensity: 0.75 * (1 - 0.45 * n) * openFactor,
    hazeOpacity: 0.05 + 0.3 * lamp,
    breathDepth: 0.035 + 0.085 * lamp,
    swayAmplitude: 0.016 + 0.012 * lamp,
    dustOpacity: (0.16 + 0.5 * lamp) * openFactor,
    exposure: 0.96 + 0.2 * n,
  };
}
