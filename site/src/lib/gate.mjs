// site/src/lib/gate.mjs — decide what this device can handle, before deciding to show it anything.
//
// Decision 5: the 3D is gated, the site never is. Every tier below renders the same DOM — the same
// 243 dishes, the same configurator, the same price maths — and only the door changes. That is the
// property the tests have to hold: a table composes identically in `poster`, so M6 verifies the
// checkout with WebGL switched off (tests/run.mjs pins `decide`, and the dist check renders the page
// without a GPU) rather than hoping the fallback is equivalent.
//
// Pure function of an environment description, so tests can hand it a fake:
//   decide({ connection, reducedMotion, webgl, cores, memory, pointer, viewportWidth })

export const TIERS = ["full", "lite", "2d", "poster"];

const COARSE_MINIMUM_WIDTH = 720;

export function decide(env = {}) {
  const {
    connection = "unknown",
    reducedMotion = false,
    webgl = true,
    cores = Number.POSITIVE_INFINITY,
    memory = Number.POSITIVE_INFINITY,
    pointer = "fine",
    viewportWidth = 1440,
  } = env;

  // Someone paying for bytes on a Nairobi 3G should not have our shaders downloaded for them.
  if (connection === "slow-2g" || connection === "2g" || connection === "3g") {
    return { tier: "poster", reason: "save-data or a metered connection", dpr: 1 };
  }

  // Vestibular preference first: a spinning table is not worth a dizzy guest. Poster plus scroll.
  if (reducedMotion) return { tier: "poster", reason: "prefers-reduced-motion", dpr: 1, scrollMotion: true };

  // No context at all — or no context the app is allowed to create (privacy modes, blocked GPUs).
  if (!webgl) return { tier: "2d", reason: "no WebGL context", dpr: 1 };

  const weakCpu = cores <= 4;
  const weakMemory = memory <= 4;
  const coarse = pointer === "coarse";
  const small = viewportWidth < COARSE_MINIMUM_WIDTH;

  if (weakCpu || weakMemory || (coarse && !small)) {
    return { tier: "lite", reason: [weakCpu && `${cores} cores`, weakMemory && `${memory}GB`, coarse && "coarse pointer"].filter(Boolean).join(", "), dpr: 1, oneLight: true, particleCap: 120 };
  }

  // A phone that reports eight cores still has a phone's thermal budget: give the door a viewport
  // floor rather than trusting the spec sheet.
  if (small) return { tier: "lite", reason: `viewport ${viewportWidth}px`, dpr: 1, oneLight: true, particleCap: 120 };

  return { tier: "full", reason: "desktop-class", dpr: Math.min(2, env.devicePixelRatio || 2) };
}

/** Read the gate from a live browser. Keep this out of decide() so decide() stays testable. */
export function readEnvironment(win = globalThis.window) {
  if (!win) return { webgl: false, connection: "unknown", reducedMotion: false, pointer: "fine", viewportWidth: 0 };
  let webgl = false;
  try {
    const canvas = win.document.createElement("canvas");
    webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }
  const conn = win.navigator?.connection || {};
  return {
    connection: conn.effectiveType || (conn.saveData ? "2g" : "unknown"),
    reducedMotion: !!win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    webgl,
    cores: win.navigator?.hardwareConcurrency ?? Number.POSITIVE_INFINITY,
    memory: win.navigator?.deviceMemory ?? Number.POSITIVE_INFINITY,
    pointer: win.matchMedia?.("(pointer: coarse)")?.matches ? "coarse" : "fine",
    viewportWidth: win.innerWidth || 0,
    devicePixelRatio: win.devicePixelRatio || 1,
  };
}
