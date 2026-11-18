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
// The street doorway and its jamb: DOOR_HALF is the opening you walk through, REVEAL_HALF the same arch
// offset outward by the thickness of a reveal. The façade is punched at REVEAL_HALF and the ring between
// the two is recessed behind it, so the entrance reads as a wall you could put your hand inside rather
// than as a cut-out pasted over the courtyard.
const DOOR_HALF = 1.5;
const REVEAL_HALF = 1.78;
const DOOR_SPRING = 2.2;

// Real limestone and real lime plaster, as 0–255 sRGB bytes. The palette's ivory side is a paper white, and
// a wall whose albedo is that high leaves ACES nothing to compress once the sun is up: the façade clips to a
// flat field and the arch loses its edges. These are the mid-tones the stone is pulled toward as daylight
// arrives, so the hour moves the light rather than the material's whiteness.
const LIMESTONE = [172, 156, 128];
const PLASTER_MID = [150, 136, 112];

// One horseshoe opening punched in a slab of wall. ExtrudeGeometry.addShape
// normalises winding itself (it reverses counter-clockwise contours and clockwise
// holes before earcut), so the hole needs no hand-tuning here.
function bayShape(THREE) {
  const outerHalf = SPAN_HALF + PIER_WIDTH;
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalf, 0);
  // The slab runs to the top of the courtyard wall, not to the lintel. With the band above the arches left
  // out, the canvas had nothing to draw there and the fallback photograph showed through the arcade: at dusk
  // that passed for sky, and in daylight it was a bright garden with a pergola beam crossing it, cutting a
  // diagonal hole in the middle of a stone room. A riad arcade is a wall with holes in it — the wall is the
  // point, and the openings are what you look through.
  shape.lineTo(-outerHalf, WALL_TOP);
  shape.lineTo(outerHalf, WALL_TOP);
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

// Lime-wash over coral stone. Without a map the arcade is one flat value per face, and a flat value under
// one directional light reads as a black slab by night and as a blown white field by day — which is exactly
// what the hero looked like. The mottling is three sine fields whose periods divide the canvas edge, so the
// tile wraps without a seam, and it is a function of (x, y) rather than of Math.random() so two reloads of
// the same hour draw the same wall.
function createPlasterTexture(THREE) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const wave = (m) => (2 * Math.PI * m) / size; // integer harmonic → the tile closes on itself
  const [k1, k2, k3] = [wave(3), wave(7), wave(11)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const n = Math.sin(x * k1 + y * k2 * 0.6) + Math.sin(x * k2 - y * k1 * 1.4) + Math.sin((x + y) * k3);
      // Warm stone, biased so the mean sits near 0.93 of full scale: the material colour multiplies this,
      // so a bright map keeps the hour tint in charge of hue while the texture only carries form.
      const v = 226 + Math.round(n * 11);
      d[i] = Math.min(255, v + 10);
      d[i + 1] = Math.min(255, v + 3);
      d[i + 2] = Math.max(0, v - 18);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Trowel sweeps: a few horizontal drags at low alpha, enough to break up a bay without reading as stripes.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#6b5a3a";
  for (let row = 0; row < 7; row += 1) {
    ctx.lineWidth = 6 + row * 2;
    ctx.beginPath();
    ctx.moveTo(0, row * 38 + 12);
    ctx.lineTo(size, row * 38 + 20);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry hands back shape coordinates as UVs, so one tile is one metre of wall — no per-material
  // repeat, and the piers and the façade agree about the scale of the grain.
  texture.anisotropy = 4;
  return texture;
}

// A concentric arch band: the opening the doorway has, offset outward by the thickness of a jamb. Used for
// the reveal behind the street façade, which is what gives the hole in the wall a depth instead of a cut-out.
function archRingShape(THREE, innerHalf, outerHalf, spring) {
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalf, 0);
  shape.lineTo(-outerHalf, spring);
  shape.absellipse(0, spring, outerHalf, outerHalf, Math.PI, 0, true);
  shape.lineTo(outerHalf, 0);
  shape.lineTo(innerHalf, 0);
  shape.lineTo(innerHalf, spring);
  shape.absellipse(0, spring, innerHalf, innerHalf, 0, Math.PI, false);
  shape.lineTo(-innerHalf, 0);
  shape.closePath();
  return shape;
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

// The sprite has to be SAMPLED, and with the coordinate that belongs to the primitive: gl_PointCoord
// inside a point sprite, the plane's uv inside a haze quad. The body that ignored uMap was the reason the
// hero looked broken — every mote drew as a solid square of light and every haze sheet as a hard-edged
// rectangle over the doorway, both of which read as a failed render rather than as lamp glow.
// sprite.rgb is already multiplied by sprite.a (createSoftDot sets premultiplyAlpha), so keeping uColor
// times rgb against alpha preserves the premultiplied convention the renderer blends with.
const softFragment = (coord) =>
  [
    "uniform float uOpacity;",
    "uniform vec3 uColor;",
    // vAlpha is declared by SOFT_PARS, which is joined in front of this body — declaring it here too is
    // a GLSL redefinition, and GLSL does not warn, it refuses: `ERROR: 0:160: 'vAlpha' : redefinition`,
    // `Fragment shader is not compiled`, `useProgram: program not valid` on every frame after that. The
    // canvas stayed transparent over the photograph and the only trace was a console that filled up.
    "void main() {",
    `  vec4 sprite = texture2D(uMap, ${coord});`,
    "  float k = vAlpha * uOpacity;",
    "  float alpha = sprite.a * k;",
    "  if (alpha <= 0.002) discard;",
    "  gl_FragColor = vec4(uColor * sprite.rgb * k, alpha);",
    "  #include <tonemapping_fragment>",
    "  #include <colorspace_fragment>",
    "}",
  ].join("\n");

const SOFT_FRAGMENT_POINTS = softFragment("gl_PointCoord");
// A varying has to be declared on both sides of the stage boundary. The vertex shader declares vUv and
// writes it; the fragment body above never mentions it (gl_PointCoord needs nothing), so the plane variant
// brings in its own declaration. Without it the haze sheet fails exactly the way a missing one does in a
// browser: VALIDATE_STATUS false, `ERROR: 'vUv' : undeclared identifier`, and no softening at all.
const SOFT_FRAGMENT_PLANE = ["varying vec2 vUv;", softFragment("vUv")].join("\n");

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
    fragmentShader: [SOFT_PARS, SOFT_FRAGMENT_POINTS].join("\n"),
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
      "varying vec2 vUv;",
      "void main() {",
      "  vUv = uv;",
      "  vec4 origin = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);",
      "  vec4 view = origin + vec4(position.xy, 0.0, 0.0);",
      "  gl_Position = projectionMatrix * view;",
      "  float r = length(position.xy) / 1.9;",
      "  float vertical = smoothstep(-1.7, 1.4, position.y);",
      "  vAlpha = clamp(1.0 - r, 0.0, 1.0) * (0.35 + 0.65 * vertical);",
      "}",
    ].join("\n"),
    fragmentShader: [SOFT_PARS, SOFT_FRAGMENT_PLANE].join("\n"),
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
  const plasterMap = track(textures, createPlasterTexture(THREE));

  const stoneMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xd9cbb2, roughness: 0.92, metalness: 0.02, map: plasterMap }));
  const plasterMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xc4b49a, roughness: 0.98, metalness: 0.0, map: plasterMap }));
  // Metal without an environment map is a black mirror. At metalness 0.85 the rail and the lantern cages
  // gave up their diffuse term to reflect a cube map that does not exist, so they drew as unlit holes cut
  // into the picture — the diagonal bar across the arch at noon was this. Brass keeps its look by borrowing
  // most of its colour from the diffuse term and a little from the lamps' specular instead.
  const brassMat = track(materials, new THREE.MeshStandardMaterial({ color: 0xc9a24d, roughness: 0.5, metalness: 0.3 }));
  const floorMat = track(materials, new THREE.MeshStandardMaterial({ color: 0x8fb6ab, roughness: 0.42, metalness: 0.08, map: floorMap }));
  // Emissive-looking surfaces are unlit basics with toneMapped off: they must stay
  // bright when the rig dims everything else, and going through the lighting model
  // would cost a shader permutation each.
  const glassMat = track(materials, new THREE.MeshBasicMaterial({ color: 0xffc46e, toneMapped: false }));
  const glowMat = track(materials, new THREE.MeshBasicMaterial({ color: 0xffb763, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false }));
  // A lamp's glow is not a solid: it is light scattered by the air, so it has to fade from its centre to
  // nothing at its edge. A sphere in a flat transparent material cannot do that — it draws as a hard disc,
  // and where two lamps overlap the discs cut angular facets into each other, which is the shape the hero
  // used to show. A Sprite carries the same soft radial texture the motes use, always faces the camera, and
  // costs one quad. No texture, no sprite: a plain quad would be the hard disc again.
  const haloMat = dot
    ? track(materials, new THREE.SpriteMaterial({ map: dot, color: 0xffb763, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false }))
    : glowMat;

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

  // --- the two walls the arcade hangs on ---
  // Seven free-standing slabs leave nothing at |x| > SPAN_HALF + PIER_WIDTH, and where the scene draws no
  // geometry the canvas stays transparent and the photograph behind it shows through. At night that reads as
  // darkness and nobody looks twice; in daylight it is a bright garden where a courtyard wall should be, and
  // the room stops being a place you could walk into. These run flush with the outer face of every pier, from
  // the street wall to the end wall. They stop at the top of the courtyard wall, which is below the height
  // the camera can see at the far end, so there is still a band of sky at the crown of the frame.
  const arcadeLength = FRONT_WALL_Z - BACK_WALL_Z - 0.2;
  const arcadeCentreZ = (FRONT_WALL_Z + BACK_WALL_Z) / 2;
  const sideWallGeo = track(geometries, new THREE.BoxGeometry(0.5, WALL_TOP, arcadeLength));
  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(sideWallGeo, plasterMat);
    sideWall.position.set(side * (SPAN_HALF + PIER_WIDTH + 0.25), WALL_TOP / 2, arcadeCentreZ);
    group.add(sideWall);
  }

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
  door.moveTo(-REVEAL_HALF, 0);
  door.lineTo(-REVEAL_HALF, DOOR_SPRING);
  door.absellipse(0, DOOR_SPRING, REVEAL_HALF, REVEAL_HALF, Math.PI, 0, true);
  door.lineTo(REVEAL_HALF, 0);
  door.closePath();
  frontShape.holes.push(door);
  const frontGeo = track(geometries, new THREE.ExtrudeGeometry(frontShape, { depth: 0.6, bevelEnabled: false, curveSegments: 12 }));
  const frontWall = new THREE.Mesh(frontGeo, plasterMat);
  frontWall.position.set(0, 0, FRONT_WALL_Z);
  group.add(frontWall);

  // The reveal itself, pushed back inside the opening so its inner faces — the two jambs and the crown —
  // are what the camera sees through the hole. Stone, not plaster, because a dressed surround is the thing
  // that says "this opening was built", and it takes the lantern spill on a different plane to the wall.
  const revealGeo = track(
    geometries,
    new THREE.ExtrudeGeometry(archRingShape(THREE, DOOR_HALF, REVEAL_HALF, DOOR_SPRING), {
      depth: 0.6,
      bevelEnabled: false,
      curveSegments: 14,
    }),
  );
  const reveal = new THREE.Mesh(revealGeo, stoneMat);
  reveal.position.set(0, 0, FRONT_WALL_Z - 0.55);
  group.add(reveal);

  // Keystone at the crown and a sconce either side. The sconces carry no light of their own — their glow
  // is the shared unlit basic that the rig already dims by day and lifts at dusk, so the entrance answers
  // the clock without three more terms in every standard-material fragment.
  const keystoneGeo = track(geometries, new THREE.BoxGeometry(0.52, 0.4, 0.2));
  const keystone = new THREE.Mesh(keystoneGeo, stoneMat);
  keystone.position.set(0, DOOR_SPRING + REVEAL_HALF + 0.06, FRONT_WALL_Z + 0.62);
  group.add(keystone);

  const sconceBodyGeo = track(geometries, new THREE.CylinderGeometry(0.07, 0.11, 0.26, 6));
  const sconceGlowGeo = track(geometries, new THREE.CircleGeometry(0.1, 12));
  const sconces = [];
  for (const side of [-1, 1]) {
    const sconce = new THREE.Group();
    sconce.position.set(side * (REVEAL_HALF + 0.62), DOOR_SPRING + 0.42, FRONT_WALL_Z + 0.62);
    const body = new THREE.Mesh(sconceBodyGeo, brassMat);
    const glow = new THREE.Mesh(sconceGlowGeo, glassMat);
    glow.position.set(0, 0.02, 0.1);
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(0.52);
    sconce.add(body, glow, halo);
    group.add(sconce);
    sconces.push(halo);
  }

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
  // Sprite scale is world size, so the glow is 0.68 across — the diameter the old 0.34 sphere occupied.
  const HALO_SIZE = 0.68;
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
    const halo = new THREE.Sprite(haloMat);
    halo.position.y = -CORD_LENGTH - 0.21;
    halo.scale.setScalar(HALO_SIZE);
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

    // The base the day is painted from and the base the night is painted from, in one line each.
    // `headroom` is how far the plaster still carries daylight toward the limestone swatch; `intoNight`
    // pushes the same wall the other way, into the courtyard colour behind it. They move opposite each
    // other with the same number, and together they are what a guest reads as "the sun moved" rather than
    // "somebody switched the lamps on". The daytime side of both stays where the ACES fix left it — see
    // rigValues, where the noon ceiling is documented — so this costs nothing at 14:00 and only deepens
    // the evening.
    const headroom = 0.5 * (1 - values.night);
    const intoNight = values.night;
    setByte(stoneMat.color, mixByte(mixByte(palette.ivory, palette.bg2, 0.55 + 0.2 * intoNight), LIMESTONE, headroom));
    setByte(plasterMat.color, mixByte(mixByte(palette.ivory, palette.bg1, 0.7 + 0.18 * intoNight), PLASTER_MID, headroom));
    // The courtyard runs seven bays deep and the openings are narrow, so past the second arch no lantern is
    // within reach — and a directional light cannot be blocked by a wall, which is exactly why the recess
    // read as a silhouette cut out of the façade instead of a space beyond it. This low warm emissive stands
    // in for the bounce the arcade throws off its own plaster. It never reaches zero, so the room is a room
    // at every hour, and it is a uniform change: no new light term, no shader recompile, works on lite.
    const bounce = 0.022 + 0.032 * values.interiorFill;
    const bounceTint = mixByte(palette.brassSoft, palette.lampGlow, values.lamp);
    setByte(stoneMat.emissive, bounceTint);
    stoneMat.emissiveIntensity = bounce;
    setByte(plasterMat.emissive, bounceTint);
    plasterMat.emissiveIntensity = bounce * 0.8;
    setByte(brassMat.color, palette.brass);
    // Brass in a lamp-lit passage does not just reflect the lamps, it holds their warmth along the rail long
    // after the light has fallen off with distance. A small emissive on the metal is the cheapest way to say
    // that, and it is the difference between a rail you can read at 22:00 and a dark line.
    setByte(brassMat.emissive, mixByte(palette.brassSoft, palette.lampGlow, values.lamp));
    brassMat.emissiveIntensity = 0.02 + 0.11 * values.lamp;
    setByte(floorMat.color, mixByte(palette.tealDeep, palette.bg1, values.night * 0.6));
    setByte(glassMat.color, palette.lampGlow);
    setByte(glowMat.color, mixByte(palette.brassSoft, palette.lampGlow, values.lamp));
    setByte(haloMat.color, mixByte(palette.brassSoft, palette.lampGlow, values.lamp));
    setByte(fog.color, mixByte(palette.bg1, palette.bg0, 0.45 * values.night));
    fog.density = 0.016 + values.night * 0.02;

    setByte(ambient.color, mixByte(palette.bg3, palette.ivory, 0.35));
    // The one light the lite tier still has. On a phone the directional trio above is not created, so
    // without this term the whole day/night difference arrives as a colour change with no change in level —
    // which is exactly what the runtime harness measured (a 20:00 frame barely separable from a 14:00 one).
    // The daytime number is held at the ACES ceiling and the night floor is what moves down, so the evening
    // is a room lit by lamps rather than a room with the ceiling light left on.
    ambient.intensity = 0.085 + 0.355 * (1 - values.night);

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
    haloMat.opacity = 0.1 + 0.3 * values.lamp;
    for (let i = 0; i < halos.length; i++) halos[i].scale.setScalar(HALO_SIZE * (0.82 + values.lamp * 0.4));
    // The sconces strike up with the same curve as the lanterns, from a smaller base: they mark the door,
    // they do not light it.
    for (let i = 0; i < sconces.length; i++) sconces[i].scale.setScalar(0.52 * (0.62 + values.lamp * 0.55));
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
      halos[i].scale.setScalar(HALO_SIZE * Math.max(0.5, flicker) * (0.82 + (values ? values.lamp : 0.6) * 0.4));
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
