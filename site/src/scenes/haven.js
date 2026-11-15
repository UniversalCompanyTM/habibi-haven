/*
 * The threshold: a run of horseshoe arches receding down the courtyard, lanterns
 * on a brass rail above them, warm light behind, the cooler street in front.
 *
 * This module never imports three.js. DoorScene.astro is the only file allowed to
 * `await import("three")`, and only on the gate-yes path (task hard rule: a static
 * three import anywhere in src/ would put ~600 kB into every page's entry graph).
 * Everything three-shaped therefore arrives through the THREE parameter.
 *
 * It also never writes --hour/--night and never carries a colour stop: hues come
 * from readPalette() (rig.js) and are pushed in through applyRig().
 */

const ARCH_SPACING = 3.0; // one bay per arch, deep into the courtyard
const PIER_WIDTH = 0.62;
const SPAN_HALF = 1.18; // clear half-width between piers
const SPRING_HEIGHT = 2.42; // where the arc starts
const ARC_RISE = 0.94; // how far the crown lifts above the springing line
const HEAD_TOP = SPRING_HEIGHT + ARC_RISE;
const LINTEL_TOP = 3.62;
const ROW_COUNT = 7;
const WALL_TOP = 5.4;
const BACK_WALL_Z = -((ROW_COUNT - 1) * ARCH_SPACING) - 1.2;
const FRONT_WALL_Z = 3.4;
const CORD_LENGTH = 0.62; // brass rail sits at RAIL_Y, flame hangs below it
const RAIL_Y = 3.68;
const LAMP_DROP = 0.86;
const FLOOR_SIZE = 34;

// One horseshoe opening punched in a slab of wall. ExtrudeGeometry.addShape
// normalises winding itself (it reverses counter-clockwise contours and clockwise
// holes before earcut), so the hole needs no hand-tuning here.
function bayShape(THREE) {
  const outerHalf = SPAN_HALF + PIER_WIDTH;
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalf, 0);
  shape.lineTo(-outerHalf, LINTEL_TOP);
  shape.lineTo(outerHalf, LINTEL_TOP);
  shape.lineTo(outerHalf, 0);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-SPAN_HALF, 0);
  hole.lineTo(-SPAN_HALF, SPRING_HEIGHT);
  // A horseshoe is more than a semicircle: the ellipse centre sits below the
  // springing line by (rise - radius), which is what makes the cheeks bulge out
  // under the crown instead of meeting it tangentially.
  const centreY = SPRING_HEIGHT - (ARC_RISE - SPAN_HALF);
  hole.absellipse(0, centreY, SPAN_HALF, ARC_RISE, Math.PI, 0, true);
  hole.lineTo(SPAN_HALF, 0);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

// Zellige-style floor: teal squares with a brass grid and an alternating rosette.
// Painted once into a canvas at boot, then repeated — cheaper than any amount of
// geometry and it keeps the courtyard reading as a place rather than a void.
function createFloorTexture(THREE) {
  const size = 512;
  const tiles = 8;
  const step = size / tiles;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0a5b52";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const ox = x * step;
      const oy = y * step;
      ctx.fillStyle = (x + y) % 2 === 0 ? "#0e6a5e" : "#084a45";
      ctx.fillRect(ox + 2, oy + 2, step - 4, step - 4);
      if ((x + y) % 2 === 0) {
        ctx.strokeStyle = "rgba(201,162,77,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ox + step / 2, oy + step / 2, step * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = "rgba(232,206,148,0.35)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  // The canvas holds sRGB bytes; without this tag three would treat them as
  // linear and the courtyard floor would come out chalky.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(FLOOR_SIZE / 3, FLOOR_SIZE / 3);
  texture.anisotropy = 4;
  return texture;
}

// Soft radial sprite shared by the dust motes and the haze sheets. Marked
// premultiplied because both shaders emit vec4(color * alpha, alpha) to match the
// renderer's default premultipliedAlpha blending.
function createSoftDot(THREE) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.42)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.premultiplyAlpha = true;
  return texture;
}

// Non-Raw ShaderMaterials get three's GLSL1->GLSL3 compatibility prefix, so
// attribute/varying/texture2D/gl_FragColor below are all legal. colorspace_fragment
// is literally `gl_FragColor = linearToOutputTexel( gl_FragColor );`, so it has to
// come after the assignment; tonemapping_fragment guards itself with
// #if defined( TONE_MAPPING ), so these bodies compile with tone mapping on or off.
const SOFT_PARS = ["uniform sampler2D uMap;", "varying float vAlpha;"].join("\n");

const SOFT_FRAGMENT = [
  "uniform float uOpacity;",
  "uniform vec3 uColor;",
  // vAlpha is declared by SOFT_PARS, which is joined in front of this body — declaring it here too is
  // a GLSL redefinition, and GLSL does not warn, it refuses: `ERROR: 0:160: 'vAlpha' : redefinition`,
  // `Fragment shader is not compiled`, `useProgram: program not valid` on every frame after that. The
  // canvas stayed transparent over the photograph and the only trace was a console that filled up.
  "void main() {",
  "  float alpha = vAlpha * uOpacity;",
  "  if (alpha <= 0.0) discard;",
  "  gl_FragColor = vec4(uColor * alpha, alpha);",
  "  #include <tonemapping_fragment>",
  "  #include <colorspace_fragment>",
  "}",
].join("\n");

// Dust that catches the lantern light. gl_PointCoord only exists in the fragment
// stage, so the vertex shader just sizes and fades each mote and the sprite is
// sampled where it belongs.
function createDust(THREE, count, dot) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 2);
  const depth = (ROW_COUNT - 1) * ARCH_SPACING;
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 9.5;
    positions[i * 3 + 1] = 0.25 + Math.random() * 3.4;
    positions[i * 3 + 2] = 2.0 - Math.random() * (depth + 3.0);
    seeds[i * 2] = Math.random();
    seeds[i * 2 + 1] = 0.35 + Math.random() * 0.65;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uScale: { value: 160 },
      uColor: { value: new THREE.Color(0xffffff) },
      uMap: { value: dot },
    },
    vertexShader: [
      "attribute vec2 seed;",
      "uniform float uTime;",
      "uniform float uScale;",
      "varying float vAlpha;",
      "void main() {",
      "  vec3 p = position;",
      "  float phase = seed.x * 6.2831853;",
      "  p.x += sin(uTime * 0.21 + phase) * 0.30;",
      "  p.y += sin(uTime * 0.13 + phase * 1.7) * 0.22;",
      "  p.z += cos(uTime * 0.17 + phase) * 0.24;",
      "  vec4 view = modelViewMatrix * vec4(p, 1.0);",
      "  gl_Position = projectionMatrix * view;",
      // Point size is in drawing-buffer pixels, so the caller folds device pixel
      // ratio into uScale at resize time.
      "  gl_PointSize = clamp(seed.y * uScale / max(-view.z, 0.35), 1.0, 26.0);",
      "  vAlpha = 0.35 + 0.65 * abs(sin(uTime * 0.6 + phase * 3.1));",
      "}",
    ].join("\n"),
    fragmentShader: [SOFT_PARS, SOFT_FRAGMENT].join("\n"),
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  // The shader moves vertices outside the baked bounding sphere; culling on the
  // original bounds would pop whole clusters of motes in and out.
  points.frustumCulled = false;
  return { points, geometry, material };
}

// A lantern-lit sheet of haze hanging in the doorway beam. Billboarded in the
// vertex shader so it always faces the camera without touching Object3D matrices
// per frame.
function createHaze(THREE, dot) {
  const geometry = new THREE.PlaneGeometry(3.6, 3.4, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uMap: { value: dot },
    },
    vertexShader: [
      "varying float vAlpha;",
      "void main() {",
      "  vec4 origin = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);",
      "  vec4 view = origin + vec4(position.xy, 0.0, 0.0);",
      "  gl_Position = projectionMatrix * view;",
      "  float r = length(position.xy) / 1.9;",
      "  float vertical = smoothstep(-1.7, 1.4, position.y);",
      "  vAlpha = clamp(1.0 - r, 0.0, 1.0) * (0.35 + 0.65 * vertical);",
      "}",
    ].join("\n"),
    fragmentShader: [SOFT_PARS, SOFT_FRAGMENT].join("\n"),
    transparent: true,
    depthWrite: false,
  });
  return { mesh: new THREE.Mesh(geometry, material), geometry, material };
}

/**
 * Build the courtyard.
 *
 * @param {object} THREE the dynamically imported three namespace (see header)
 * @param {{ tier?: string, oneLight?: boolean, particleCap?: number }} options
 *        flags straight out of gate.mjs's decide(): `oneLight` and a reduced
 *        particle cap are what make the `lite` tier cheap, and this function is
 *        the only place they cost anything.
 */
export function buildHaven(THREE, options = {}) {
  const lite = options.oneLight === true || options.tier === "lite";
  const dustCount = Math.max(0, Math.min(options.particleCap ?? (lite ? 120 : 320), 600));

  const geometries = [];
  const materials = [];
  const textures = [];
  const track = (bag, item) => {
    if (item) bag.push(item);
    return item;
  };

  const group = new THREE.Group();
  const dot = track(textures, createSoftDot(THREE));
  const floorMap = track(textures, createFloorTexture(THREE));

  const stoneMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xd9cbb2, roughness: 0.92, metalness: 0.02 }));
  const plasterMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xc4b49a, roughness: 0.98, metalness: 0.0 }));
  const brassMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xc9a24d, roughness: 0.34, metalness: 0.85 }));
  const floorMat = track(materials, new THREE.MeshStandardMaterial({ color: 0x8fb6ab, roughness: 0.42, metalness: 0.08, map: floorMap }));
  // Emissive-looking surfaces are unlit basics with toneMapped off: they must stay
  // bright when the rig dims everything else, and going through the lighting model
  // would cost a shader permutation each.
  const glassMat = track(materials, new THREE.MeshBasicMaterial({ color: 0xffc46e, toneMapped: false }));
  const glowMat = track(materials, new THREE.MeshBasicMaterial({ color: 0xffb763, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false }));

  // --- arcade: seven identical bays, one InstancedMesh, one draw call ---
  const bayGeo = track(geometries, new THREE.ExtrudeGeometry(bayShape(THREE), { depth: 0.46, bevelEnabled: false, curveSegments: 14 }));
  const arcade = new THREE.InstancedMesh(bayGeo, stoneMat, ROW_COUNT);
  const placement = new THREE.Matrix4();
  for (let i = 0; i < ROW_COUNT; i++) {
    placement.makeTranslation(0, 0, -(i * ARCH_SPACING));
    arcade.setMatrixAt(i, placement);
  }
  arcade.instanceMatrix.needsUpdate = true;
  group.add(arcade);

  // --- courtyard end wall, with a rose window so the night sky reads through ---
  const backShape = new THREE.Shape();
  backShape.moveTo(-7.4, 0);
  backShape.lineTo(-7.4, WALL_TOP);
  backShape.lineTo(7.4, WALL_TOP);
  backShape.lineTo(7.4, 0);
  backShape.closePath();
  const rose = new THREE.Path();
  rose.absarc(0, 3.5, 1.05, 0, Math.PI * 2, true);
  backShape.holes.push(rose);
  const backGeo = track(geometries, new THREE.ExtrudeGeometry(backShape, { depth: 0.5, bevelEnabled: false, curveSegments: 12 }));
  const backWall = new THREE.Mesh(backGeo, plasterMat);
  backWall.position.set(0, 0, BACK_WALL_Z);
  group.add(backWall);

  const roseGlowGeo = track(geometries, new THREE.CircleGeometry(1.02, 24));
  const roseGlow = new THREE.Mesh(roseGlowGeo, glowMat);
  roseGlow.position.set(0, 3.5, BACK_WALL_Z + 0.52);
  group.add(roseGlow);

  // --- street façade: the arch you actually walk under ---
  const frontShape = new THREE.Shape();
  frontShape.moveTo(-6.6, 0);
  frontShape.lineTo(-6.6, 4.9);
  frontShape.lineTo(6.6, 4.9);
  frontShape.lineTo(6.6, 0);
  frontShape.closePath();
  const door = new THREE.Path();
  door.moveTo(-1.5, 0);
  door.lineTo(-1.5, 2.2);
  door.absellipse(0, 2.2, 1.5, 1.5, Math.PI, 0, true);
  door.lineTo(1.5, 0);
  door.closePath();
  frontShape.holes.push(door);
  const frontGeo = track(geometries, new THREE.ExtrudeGeometry(frontShape, { depth: 0.6, bevelEnabled: false, curveSegments: 12 }));
  const frontWall = new THREE.Mesh(frontGeo, plasterMat);
  frontWall.position.set(0, 0, FRONT_WALL_Z);
  group.add(frontWall);

  // --- floor ---
  const floorGeo = track(geometries, new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = BACK_WALL_Z / 2;
  group.add(floor);

  // --- brass rail the lanterns hang from ---
  const railGeo = track(geometries, new THREE.CylinderGeometry(0.035, 0.035, (ROW_COUNT - 1) * ARCH_SPACING + 2.2, 6));
  const rail = new THREE.Mesh(railGeo, brassMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(0, RAIL_Y, -(ARCH_SPACING * (ROW_COUNT - 1)) / 2 + 0.4);
  group.add(rail);

  // --- lanterns: each pivot swings about the rail, so the whole lamp body follows ---
  const lampCount = lite ? 3 : 5;
  const cordGeo = track(geometries, new THREE.CylinderGeometry(0.012, 0.012, CORD_LENGTH, 4));
  const cageGeo = track(geometries, new THREE.CylinderGeometry(0.19, 0.14, 0.42, 6, 1, true));
  const flameGeo = track(geometries, new THREE.OctahedronGeometry(0.11, 0));
  const haloGeo = track(geometries, new THREE.SphereGeometry(0.34, 10, 8));
  const pivots = [];
  const flames = [];
  const halos = [];
  for (let i = 0; i < lampCount; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, RAIL_Y, 1.4 - i * (ARCH_SPACING * 0.95));
    const cord = new THREE.Mesh(cordGeo, brassMat);
    cord.position.y = -CORD_LENGTH / 2;
    const cage = new THREE.Mesh(cageGeo, brassMat);
    cage.position.y = -CORD_LENGTH - 0.21;
    const flame = new THREE.Mesh(flameGeo, glassMat);
    flame.position.y = -CORD_LENGTH - 0.21;
    const halo = new THREE.Mesh(haloGeo, glowMat);
    halo.position.y = -CORD_LENGTH - 0.21;
    pivot.add(cord, cage, flame, halo);
    // Phase comes from the index, not Math.random(), so two reloads of the same
    // hour animate identically.
    pivot.userData.phase = i * 1.31;
    group.add(pivot);
    pivots.push(pivot);
    flames.push(flame);
    halos.push(halo);
  }

  const haze = [];
  const hazeCount = lite ? 2 : 4;
  for (let i = 0; i < hazeCount; i++) {
    const sheet = createHaze(THREE, dot);
    track(geometries, sheet.geometry);
    track(materials, sheet.material);
    sheet.mesh.position.set(0, 1.9, 0.6 - i * ARCH_SPACING);
    group.add(sheet.mesh);
    haze.push(sheet);
  }

  let dust = null;
  if (dustCount > 0 && dot) {
    dust = createDust(THREE, dustCount, dot);
    track(geometries, dust.geometry);
    track(materials, dust.material);
    group.add(dust.points);
  }

  // --- lights ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  group.add(ambient);
  const lampCountForLights = lite ? 1 : 3;
  const lanternLights = [];
  for (let i = 0; i < lampCountForLights; i++) {
    const light = new THREE.PointLight(0xffb763, 1.2, 14, 1.7);
    light.position.set(0, RAIL_Y - LAMP_DROP, 1.4 - i * ARCH_SPACING * 2);
    group.add(light);
    lanternLights.push(light);
  }
  // On the lite tier the three directional lights would be three more shadow-free
  // terms in every standard-material fragment; the ambient plus one point light is
  // enough to keep the arches legible.
  let streetLight = null;
  let skyLight = null;
  let bounceLight = null;
  if (!lite) {
    streetLight = new THREE.DirectionalLight(0xbcd6e0, 1.0);
    streetLight.position.set(2.4, 4.2, 12);
    group.add(streetLight);
    skyLight = new THREE.DirectionalLight(0x8fb6ab, 0.4);
    skyLight.position.set(-6, 8, BACK_WALL_Z);
    group.add(skyLight);
    bounceLight = new THREE.DirectionalLight(0xffd9a0, 0.5);
    bounceLight.position.set(0, 0.6, BACK_WALL_Z + 4);
    group.add(bounceLight);
  }

  const fog = new THREE.FogExp2(0x0b2523, 0.02);
  group.fog = fog;

  /**
   * Paint the scene from the clock. Colours go in as sRGB bytes and are converted
   * explicitly via setRGB(..., SRGBColorSpace) so the result cannot depend on how
   * the renderer happens to be configured. Only colours, intensities and opacities
   * change — none of those flip materialProperties.needsProgramChange, so a repaint
   * never recompiles a shader.
   */
  function applyRig(values, palette) {
    const setByte = (color, rgb) => color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
    const mixByte = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    setByte(stoneMat.color, mixByte(palette.ivory, palette.bg2, 0.55));
    setByte(plasterMat.color, mixByte(palette.ivory, palette.bg1, 0.7));
    setByte(brassMat.color, palette.brass);
    setByte(floorMat.color, mixByte(palette.tealDeep, palette.bg1, values.night * 0.6));
    setByte(glassMat.color, palette.lampGlow);
    setByte(glowMat.color, mixByte(palette.brassSoft, palette.lampGlow, values.lamp));
    setByte(fog.color, palette.bg1);
    fog.density = 0.016 + values.night * 0.014;

    setByte(ambient.color, mixByte(palette.bg3, palette.ivory, 0.35));
    ambient.intensity = 0.16 + 0.34 * (1 - values.night);

    for (let i = 0; i < lanternLights.length; i++) {
      setByte(lanternLights[i].color, palette.lampGlow);
      lanternLights[i].intensity = values.lanternIntensity * (i === 0 ? 1 : 0.72);
    }
    if (streetLight) {
      setByte(streetLight.color, mixByte(palette.ivory, palette.bg3, 0.4));
      streetLight.intensity = values.streetIntensity;
    }
    if (skyLight) {
      setByte(skyLight.color, palette.tealDeep);
      skyLight.intensity = values.skyIntensity;
    }
    if (bounceLight) {
      setByte(bounceLight.color, palette.brassSoft);
      bounceLight.intensity = values.bounceIntensity;
    }

    glowMat.opacity = 0.12 + 0.34 * values.lamp;
    for (let i = 0; i < halos.length; i++) halos[i].scale.setScalar(0.82 + values.lamp * 0.4);
    for (let i = 0; i < haze.length; i++) haze[i].material.uniforms.uOpacity.value = values.hazeOpacity;
    for (let i = 0; i < haze.length; i++) setByte(haze[i].material.uniforms.uColor.value, palette.lampGlow);
    if (dust) {
      dust.material.uniforms.uOpacity.value = values.dustOpacity;
      setByte(dust.material.uniforms.uColor.value, palette.brassSoft);
    }
  }

  /**
   * Advance the physical motion. Called once per animation frame, so it allocates
   * nothing: every vector it touches is written in place.
   */
  function update(seconds, pointerX, pointerY, values) {
    const sway = values ? values.swayAmplitude : 0.02;
    const breath = values ? values.breathDepth : 0.06;
    for (let i = 0; i < pivots.length; i++) {
      const phase = pivots[i].userData.phase;
      pivots[i].rotation.z = Math.sin(seconds * 0.62 + phase) * sway;
      pivots[i].rotation.x = Math.cos(seconds * 0.47 + phase) * sway * 0.6;
      const flicker = 1 + Math.sin(seconds * 2.7 + phase * 2.1) * breath + Math.sin(seconds * 6.1 + phase) * breath * 0.35;
      flames[i].scale.setScalar(Math.max(0.6, flicker));
      halos[i].scale.setScalar(Math.max(0.5, flicker) * (0.82 + (values ? values.lamp : 0.6) * 0.4));
    }
    if (dust) dust.material.uniforms.uTime.value = seconds;
    // Pointer parallax stays inside a couple of degrees: the brief asks for a few
    // centimetres of drift, not a game camera.
    group.rotation.y = pointerX * 0.045;
    group.rotation.x = pointerY * 0.02;
  }

  /**
   * Keep mote sizes honest for the current buffer height. `pixelRatio` comes from
   * the renderer because gl_PointSize is measured in drawing-buffer pixels.
   */
  function resize(height, pixelRatio) {
    if (!dust) return;
    const cssScale = Math.max(height * 0.14, 90);
    dust.material.uniforms.uScale.value = Math.min(cssScale * pixelRatio, 420);
  }

  function dispose() {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    arcade.dispose();
    group.clear();
  }

  return { group, fog, applyRig, update, resize, dispose };
}
