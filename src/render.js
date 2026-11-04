// The three.js side: builds a level as instanced blocks, lights it with a
// directional light that follows the game's sun, and animates the shade.
import * as THREE from "three";
import { KIND, SCORCH_TIME, sunDir } from "./core.js";

const COLORS = {
  floor: new THREE.Color("#dcbd92"),
  pillar: new THREE.Color("#c99f70"),
  pillarTall: new THREE.Color("#a97e5c"),
  gate: new THREE.Color("#7c5a44"),
  sensor: new THREE.Color("#a08e5e"),
  shade: new THREE.Color("#1b1626"),
  eye: new THREE.Color("#d8ecff"),
  dew: new THREE.Color("#d8f2ff"),
  wellRim: new THREE.Color("#6e5f80"),
};

// The camera looks down, so what shows behind the island is the part of the
// sky sphere below the horizon: a hazy ground that warms as the sun sinks.
const SKY = {
  low: { top: new THREE.Color("#d98a6a"), horizon: new THREE.Color("#ffd2a0"), bottom: new THREE.Color("#8d5c62") },
  high: { top: new THREE.Color("#78b2e4"), horizon: new THREE.Color("#dbe9f3"), bottom: new THREE.Color("#6d8aa3") },
};

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    this.camYaw = 0.3;
    this.camPitch = 1.05; // steep enough that shadows behind a pillar stay in view

    this.sun = new THREE.DirectionalLight(0xfff1d6, 3.1);
    this.sun.castShadow = true;
    const shadowSize = this.coarse ? 1024 : 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8f0, 0x7a5a48, 0.85);
    this.scene.add(this.hemi);

    this.sky = makeSky();
    this.scene.add(this.sky);
    this.sunSprite = makeSunSprite(1.0, 12);
    this.sunHalo = makeSunSprite(0.35, 40);
    this.scene.add(this.sunSprite, this.sunHalo);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.level = null;
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.winT = 0;
    this.shake = 0;
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.fitCamera();
  }

  // Optional override for captures: { yaw, pitch, dist, target: [x, y, z] }.
  setCamera(override) {
    this.override = override || null;
    this.fitCamera();
  }

  fitCamera() {
    if (!this.level) return;
    const L = this.level;
    const R = Math.hypot(L.w / 2, L.h / 2) + 1.4;
    const v = (this.camera.fov * Math.PI) / 360;
    const hAngle = Math.atan(Math.tan(v) * this.camera.aspect);
    const half = Math.min(v, hAngle);
    const o = this.override || {};
    const D = o.dist ?? (R / Math.sin(half)) * 1.02;
    const y = o.pitch ?? this.camPitch;
    const yaw = o.yaw ?? this.camYaw;
    const t = o.target || [0, 0.4, 0];
    this.camera.position.set(t[0] + Math.sin(yaw) * Math.cos(y) * D, t[1] + Math.sin(y) * D + 0.6, t[2] + Math.cos(yaw) * Math.cos(y) * D);
    this.camera.lookAt(t[0], t[1], t[2]);
    this.camera.updateProjectionMatrix();
    this.baseCamPos = this.camera.position.clone();
  }

  clear() {
    this.world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.world.clear();
  }

  setLevel(game) {
    this.clear();
    const L = game.level;
    this.level = L;
    this.game = game;
    this.winT = 0;
    this.ox = -L.w / 2 + 0.5;
    this.oz = -L.h / 2 + 0.5;
    const n = L.w * L.h;

    // Floor tiles (and the floor under gates).
    const floorCells = [];
    const pillarCells = [];
    for (let i = 0; i < n; i++) {
      const k = L.kind[i];
      if (k === KIND.PILLAR) pillarCells.push(i);
      else if (k !== KIND.VOID) floorCells.push(i);
    }
    const floorGeo = new THREE.BoxGeometry(0.96, 1.3, 0.96).translate(0, -0.65, 0);
    const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.floor = new THREE.InstancedMesh(floorGeo, stone, floorCells.length);
    this.floor.castShadow = true;
    this.floor.receiveShadow = true;
    floorCells.forEach((i, j) => {
      const x = i % L.w;
      const z = (i - x) / L.w;
      tmpM.makeTranslation(x + this.ox, 0, z + this.oz);
      this.floor.setMatrixAt(j, tmpM);
      const seed = hash(x * 7 + z * 13 + 1);
      tmpC.copy(COLORS.floor).offsetHSL(seed * 0.02 - 0.01, 0, (hash(seed) - 0.5) * 0.08 + ((x + z) % 2) * 0.012);
      if (L.kind[i] === KIND.EXIT) tmpC.multiplyScalar(0.85);
      this.floor.setColorAt(j, tmpC);
    });
    this.world.add(this.floor);

    // Pillars.
    const pillarGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.pillars = new THREE.InstancedMesh(pillarGeo, stone, Math.max(1, pillarCells.length));
    this.pillars.count = pillarCells.length;
    this.pillars.castShadow = true;
    this.pillars.receiveShadow = true;
    pillarCells.forEach((i, j) => {
      const x = i % L.w;
      const z = (i - x) / L.w;
      const h = L.height[i];
      tmpP.set(x + this.ox, 0, z + this.oz);
      tmpS.set(1, h, 1);
      tmpM.compose(tmpP, tmpQ.identity(), tmpS);
      this.pillars.setMatrixAt(j, tmpM);
      const t = Math.min(1, (h - 1) / 6);
      tmpC.copy(COLORS.pillar).lerp(COLORS.pillarTall, t).offsetHSL(0, 0, (hash(x * 31 + z * 17 + 5) - 0.5) * 0.07);
      this.pillars.setColorAt(j, tmpC);
    });
    this.world.add(this.pillars);

    // Gates.
    this.gates = L.gates.map((g) => {
      const geo = new THREE.BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.gate, roughness: 0.8 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(g.x + this.ox, 0, g.z + this.oz);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), new THREE.MeshStandardMaterial({ color: 0x5a3f30, roughness: 0.7 }));
      bar.position.y = 0.94;
      bar.castShadow = true;
      m.add(bar);
      this.world.add(m);
      return m;
    });

    // Sun stones.
    this.sensors = L.sensors.map((s) => {
      const geo = new THREE.CylinderGeometry(0.33, 0.38, 0.1, 24);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.sensor, roughness: 0.5, emissive: 0xffb33c, emissiveIntensity: 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x + this.ox, 0.05, s.z + this.oz);
      m.receiveShadow = true;
      m.castShadow = true;
      const mark = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 24), new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.6 }));
      mark.rotation.x = Math.PI / 2;
      mark.position.y = 0.06;
      m.add(mark);
      m.userData.index = s.z * L.w + s.x;
      this.world.add(m);
      return m;
    });

    // Dew.
    this.dew = L.dew.map((d, j) => {
      const geo = new THREE.SphereGeometry(0.13, 18, 14);
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.dew, roughness: 0.15, emissive: 0x3d8fd6, emissiveIntensity: 0.7 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(d.x + this.ox, 0.22, d.z + this.oz);
      m.castShadow = true;
      m.userData.index = d.z * L.w + d.x;
      m.userData.phase = j * 1.7;
      this.world.add(m);
      return m;
    });

    // The well.
    const well = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.08, 10, 28), new THREE.MeshStandardMaterial({ color: COLORS.wellRim, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.07;
    rim.castShadow = true;
    rim.receiveShadow = true;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.33, 28), new THREE.MeshBasicMaterial({ color: 0x0b0714 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.012;
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.33, 28), new THREE.MeshBasicMaterial({ color: 0x4b3775, transparent: true, opacity: 0.7 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.014;
    well.add(rim, hole, glow);
    well.position.set(L.exit.x + this.ox, 0, L.exit.z + this.oz);
    this.well = well;
    this.wellGlow = glow;
    this.world.add(well);

    // The shade.
    const shade = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.shade, roughness: 0.95, emissive: 0xff7a2a, emissiveIntensity: 0 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), bodyMat);
    body.scale.set(1, 0.85, 1);
    body.castShadow = true;
    body.position.y = 0.28;
    const eyeGeo = new THREE.SphereGeometry(0.048, 10, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: COLORS.eye });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 0.33, 0.25);
    eyeR.position.set(0.1, 0.33, 0.25);
    shade.add(body, eyeL, eyeR);
    // A faint silhouette that only draws where a pillar hides the shade.
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), new THREE.MeshBasicMaterial({ color: 0xcdbdf0, transparent: true, opacity: 0.5, depthFunc: THREE.GreaterDepth, depthWrite: false }));
    ghost.scale.set(1, 0.85, 1);
    ghost.position.y = 0.28;
    ghost.renderOrder = 20;
    shade.add(ghost);
    this.shadeGhost = ghost;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 28), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.016;
    shade.add(ring);
    this.shade = shade;
    this.shadeBody = body;
    this.shadeEyes = [eyeL, eyeR];
    this.heatRing = ring;
    this.world.add(shade);

    // Path dots.
    const dotGeo = new THREE.CircleGeometry(0.09, 12).rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x2a2138, transparent: true, opacity: 0.45 });
    this.dots = new THREE.InstancedMesh(dotGeo, dotMat, 160);
    this.dots.count = 0;
    this.world.add(this.dots);

    // The dial: a ring around the island, and the sun as an orb on it.
    const ringR = Math.hypot(L.w / 2, L.h / 2) + 1.3;
    this.ringR = ringR;
    const dial = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.045, 8, 96), new THREE.MeshBasicMaterial({ color: 0xf2d8a0, transparent: true, opacity: 0.55 }));
    dial.rotation.x = Math.PI / 2;
    dial.position.y = -0.45;
    this.world.add(dial);
    const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.04, 0.3), new THREE.MeshBasicMaterial({ color: 0xf2d8a0, transparent: true, opacity: 0.55 }), 24);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      tmpP.set(Math.sin(a) * ringR, -0.45, Math.cos(a) * ringR);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      tmpS.setScalar(i % 6 === 0 ? 1.8 : 1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      ticks.setMatrixAt(i, tmpM);
    }
    this.world.add(ticks);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }));
    const orbGlow = makeSunSprite(0.9, 2.6);
    orb.add(orbGlow);
    this.orb = orb;
    this.world.add(orb);

    // Shadow camera covers the whole island from any direction.
    const R = Math.hypot(L.w / 2, L.h / 2) + 2;
    const sc = this.sun.shadow.camera;
    sc.left = -R;
    sc.right = R;
    sc.top = R;
    sc.bottom = -R;
    sc.near = 1;
    sc.far = 120;
    sc.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, 0);
    this.fitCamera();
    this.update(game, 0);
  }

  cellToWorld(i, out) {
    const x = i % this.level.w;
    const z = (i - x) / this.level.w;
    return out.set(x + this.ox, 0, z + this.oz);
  }

  update(game, dt) {
    this.time += dt;
    if (!this.level || !game) return;
    const L = this.level;
    // Sun.
    const d = sunDir(game.az, game.el);
    const dist = 50;
    this.sun.position.set(d[0] * dist, d[1] * dist, d[2] * dist);
    this.sunSprite.position.set(d[0] * 260, d[1] * 260, d[2] * 260);
    this.sunHalo.position.copy(this.sunSprite.position);
    if (this.orb) {
      const r = this.ringR;
      const rise = -0.2 + (game.el / 90) * 2.2;
      this.orb.position.set(d[0] * r, rise, d[2] * r);
      this.orb.scale.setScalar(0.85 + (game.el / 90) * 0.5);
    }
    const t = clamp((game.el - 20) / 42, 0, 1);
    this.sun.color.copy(new THREE.Color("#ffb070")).lerp(new THREE.Color("#fff3dc"), t);
    this.sun.intensity = 2.6 + t * 0.8;
    this.hemi.intensity = 0.7 + t * 0.3;
    const u = this.sky.material.uniforms;
    u.top.value.copy(SKY.low.top).lerp(SKY.high.top, t);
    u.horizon.value.copy(SKY.low.horizon).lerp(SKY.high.horizon, t);
    u.bottom.value.copy(SKY.low.bottom).lerp(SKY.high.bottom, t);
    this.hemi.color.copy(u.top.value);

    // Gates sink when open.
    for (const g of this.gates) {
      const target = game.gateOpen ? -1.08 : 0;
      g.position.y += (target - g.position.y) * Math.min(1, dt * 3);
    }
    // Sun stones glow once latched.
    for (const s of this.sensors) {
      const lit = game.sensorLit(s.userData.index);
      const target = lit ? 1.4 + Math.sin(this.time * 4) * 0.2 : 0;
      s.material.emissiveIntensity += (target - s.material.emissiveIntensity) * Math.min(1, dt * 4);
    }
    // Dew bobs and vanishes when gathered.
    for (const m of this.dew) {
      const got = game.collected.has(m.userData.index);
      m.visible = !got;
      m.position.y = 0.24 + Math.sin(this.time * 2.6 + m.userData.phase) * 0.05;
      m.rotation.y = this.time;
    }
    this.wellGlow.material.opacity = 0.55 + Math.sin(this.time * 2) * 0.2;

    // The shade.
    const [sx, sz, hop] = game.shadePosition();
    this.shade.position.set(sx + this.ox, 0, sz + this.oz);
    this.shadeBody.position.y = 0.28 + hop * 0.09;
    const heat = game.heat;
    this.shadeBody.material.emissiveIntensity = heat * 1.6;
    this.heatRing.material.opacity = heat * 0.9;
    this.heatRing.scale.setScalar(1 + heat * 0.3);
    const eyeScale = game.hold ? 0.25 : 1;
    for (const e of this.shadeEyes) e.scale.y += (eyeScale - e.scale.y) * Math.min(1, dt * 10);
    if (game.state === "scorched") {
      const k = Math.max(0, game.timer / SCORCH_TIME);
      this.shade.scale.setScalar(0.2 + k * 0.8);
      this.shadeBody.material.emissiveIntensity = 2.5 * k;
      this.shadeBody.position.y = 0.28 + (1 - k) * 0.5;
    } else if (game.state === "won") {
      this.winT += dt;
      const k = clamp(this.winT / 0.8, 0, 1);
      this.shade.scale.setScalar(1 - k * 0.9);
      this.shade.position.y = -k * 0.5;
      this.shade.rotation.y = k * 6;
    } else {
      this.shade.scale.setScalar(1);
      this.shade.position.y = 0;
      this.shade.rotation.y = 0;
      this.winT = 0;
    }

    // Path dots.
    const path = game.hold || game.state !== "playing" ? null : game.path;
    let count = 0;
    if (path) {
      for (let i = 1; i < path.length && count < 160; i++) {
        this.cellToWorld(path[i], tmpP);
        tmpP.y = 0.012;
        tmpM.makeTranslation(tmpP.x, tmpP.y, tmpP.z);
        this.dots.setMatrixAt(count++, tmpM);
      }
      this.dots.instanceMatrix.needsUpdate = true;
    }
    this.dots.count = count;
  }

  // Screen position of the shade, for tap detection.
  shadeScreen() {
    if (!this.shade) return null;
    tmpP.copy(this.shade.position);
    tmpP.y += 0.3;
    tmpP.project(this.camera);
    return { x: ((tmpP.x + 1) / 2) * this.width, y: ((1 - tmpP.y) / 2) * this.height };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color("#78b2e4") },
      horizon: { value: new THREE.Color("#dbe9f3") },
      bottom: { value: new THREE.Color("#4e4a5c") },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.75, y), 0.8)) : mix(horizon, bottom, smoothstep(0.1, 0.95, -y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 20), mat);
  mesh.frustumCulled = false;
  return mesh;
}

function makeSunSprite(alpha, size) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,250,225,${alpha})`);
  grad.addColorStop(0.45, `rgba(255,236,180,${alpha * 0.9})`);
  grad.addColorStop(1, "rgba(255,220,160,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}
