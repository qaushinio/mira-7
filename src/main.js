import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createTrack } from "./track.js";
import { createRobot } from "./robot.js";
import { createDirector } from "./motion.js";

const canvas = document.getElementById("view");
const kickerEl = document.getElementById("kicker");
const lineEl = document.getElementById("line");
const tuneEl = document.getElementById("tune");
const buttons = [...document.querySelectorAll("#dock button")];
const params = new URLSearchParams(location.search);
const showTune = params.has("tune");
if (showTune) tuneEl.hidden = false;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14181d);
scene.fog = new THREE.Fog(0x14181d, 9, 20);
scene.environmentIntensity = 0.62;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.08, 50);

const hemi = new THREE.HemisphereLight(0xc5d4de, 0x2a241c, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1df, 3.1);
sun.position.set(4.5, 8.5, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -7;
sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 22;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);

const fill = new THREE.DirectionalLight(0xd5e4ff, 0.85);
fill.position.set(-4, 3.2, 5);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x9ecfff, 1.15);
rim.position.set(-3, 4, -4);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(18, 64),
  new THREE.MeshStandardMaterial({ color: 0x12161b, roughness: 0.92, metalness: 0.04 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(16, 16, 0x2a343c, 0x1c242b);
grid.position.y = 0.004;
scene.add(grid);

const track = createTrack();

function ribbon(offset, color, y, opacity) {
  const steps = 220;
  const positions = [];
  const indices = [];
  const half = offset;
  for (let i = 0; i <= steps; i++) {
    const p = track.pointAt((i / steps) * track.length);
    const ox = -p.tz * half;
    const oz = p.tx * half;
    positions.push(p.x + ox, y, p.z + oz, p.x - ox, y, p.z - oz);
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.08,
      emissive: color,
      emissiveIntensity: 0.18,
      transparent: opacity < 1,
      opacity,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

scene.add(ribbon(0.46, 0x14302c, 0.012, 1));

function loopLine(offset, color, y) {
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const p = track.pointAt((i / 240) * track.length);
    pts.push(new THREE.Vector3(p.x - p.tz * offset, y, p.z + p.tx * offset));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
}
scene.add(loopLine(0.46, 0x3dbea5, 0.02));
scene.add(loopLine(-0.46, 0x2a6d62, 0.02));
scene.add(loopLine(0, 0xc8c2b6, 0.018));

function paintLogo() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(232,228,220,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(232,228,220,0.85)";
  ctx.font = "700 42px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MIRA-7", 128, 118);
  ctx.fillStyle = "rgba(61,190,165,0.9)";
  ctx.font = "600 14px Segoe UI, sans-serif";
  ctx.fillText("SHOWROOM", 128, 152);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 48),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  decal.rotation.order = "YXZ";
  decal.rotation.x = -Math.PI / 2;
  decal.rotation.z = Math.PI;
  decal.position.y = 0.02;
  return decal;
}
scene.add(paintLogo());

const hurdles = track.hurdles.map((dist) => {
  const p = track.pointAt(dist);
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);
  group.rotation.y = Math.atan2(-p.tz, p.tx);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c261e, roughness: 0.62, metalness: 0.25 });
  const barMat = new THREE.MeshStandardMaterial({
    color: 0xd0893e,
    emissive: 0xa85a18,
    emissiveIntensity: 0.5,
    roughness: 0.38,
    metalness: 0.18,
  });
  for (const side of [-0.66, 0.66]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.5, 12), postMat);
    post.position.set(0, 0.25, side);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 1.4), barMat);
  bar.position.set(0, 0.36, 0);
  bar.castShadow = true;
  group.add(bar);
  group.userData.mat = barMat;
  group.userData.glow = 0;
  scene.add(group);
  return group;
});

for (const [sx, sz] of [
  [-3.2, -3.2],
  [3.2, -3.2],
  [3.2, 3.2],
  [-3.2, 3.2],
]) {
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0x23272b, metalness: 0.7, roughness: 0.35 }),
  );
  housing.position.set(sx, 3.35, sz);
  scene.add(housing);
}

const robot = createRobot();
scene.add(robot.root);
const director = createDirector(track, robot);

const blob = new THREE.Mesh(
  new THREE.CircleGeometry(0.34, 28),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
);
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.018;
scene.add(blob);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.2, 0.28, 32),
  new THREE.MeshBasicMaterial({ color: 0x3dbea5, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.03;
ring.visible = false;
scene.add(ring);
let ringLife = 0;

const lookTarget = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
let dist = 1;
let hold = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;

function frameCamera(view, dt, snap) {
  if (view.framing === "stage") {
    desiredLook.set(0, 0.78, 0);
    desiredPos.set(1.7 * dist, 1.15 * dist, 3.55 * dist);
  } else {
    const lift = Math.max(0, view.y);
    desiredLook.set(view.x, 0.88 + lift * 0.72, view.z);
    desiredPos.set(
      view.x + view.hx * 2.55 * dist + view.rx * 2.15 * dist,
      0.42 + 1.22 * dist + lift * 0.85,
      view.z + view.hz * 2.55 * dist + view.rz * 2.15 * dist,
    );
  }
  if (snap) {
    camera.position.copy(desiredPos);
    lookTarget.copy(desiredLook);
    camera.lookAt(lookTarget);
    return;
  }
  const glide = 1 - Math.exp(-3.4 * dt);
  lookTarget.lerp(desiredLook, 1 - Math.exp(-4.5 * dt));
  if (!dragging && hold <= 0) camera.position.lerp(desiredPos, glide);
  camera.lookAt(lookTarget);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  hold = 1e9;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const offset = camera.position.clone().sub(lookTarget);
  const yaw = -dx * 0.005;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const ox = offset.x * cos - offset.z * sin;
  const oz = offset.x * sin + offset.z * cos;
  offset.x = ox;
  offset.z = oz;
  offset.y = Math.max(0.35, Math.min(5.5, offset.y - dy * 0.008));
  camera.position.copy(lookTarget).add(offset);
});
function endDrag() {
  if (!dragging) return;
  dragging = false;
  hold = 4.2;
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY) || 1;
    dist = Math.max(0.62, Math.min(1.75, dist * (1 + dir * 0.08)));
  },
  { passive: false },
);

function syncButtons() {
  for (const button of buttons) {
    button.setAttribute("aria-pressed", button.dataset.mode === director.mode ? "true" : "false");
  }
}
for (const button of buttons) {
  button.addEventListener("click", () => {
    director.setMode(button.dataset.mode);
    syncButtons();
  });
}
window.addEventListener("keydown", (e) => {
  const map = { "1": "show", "2": "walk", "3": "run", "4": "dance" };
  if (map[e.key]) {
    director.setMode(map[e.key]);
    syncButtons();
  }
});

let lastCaption = "";
let lastKicker = "";
const clock = new THREE.Clock();

function consume(view) {
  if (view.kicker !== lastKicker) {
    kickerEl.textContent = view.kicker;
    lastKicker = view.kicker;
  }
  if (view.caption !== lastCaption) {
    lineEl.textContent = view.caption;
    lastCaption = view.caption;
  }
  for (const event of view.events) {
    if (event.type === "clear" && hurdles[event.index]) hurdles[event.index].userData.glow = 1;
    if (event.type === "land") {
      ring.visible = true;
      ringLife = 1;
      ring.position.set(event.x, 0.03, event.z);
      ring.scale.setScalar(0.4);
    }
  }
  blob.position.set(view.x, 0.018, view.z);
  const lift = Math.max(0, view.y);
  blob.material.opacity = Math.max(0, 0.33 * (1 - lift / 0.85));
  blob.scale.setScalar(0.85 + lift * 0.7);
  if (showTune) tuneEl.textContent = view.debug;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (hold > 0 && !dragging) hold -= dt;
  const view = director.update(dt);
  consume(view);
  frameCamera(view, dt, false);
  for (const hurdle of hurdles) {
    if (hurdle.userData.glow > 0.01) {
      hurdle.userData.glow *= Math.pow(0.08, dt);
      hurdle.userData.mat.emissiveIntensity = 0.5 + hurdle.userData.glow * 2.4;
    } else if (hurdle.userData.glow !== 0) {
      hurdle.userData.glow = 0;
      hurdle.userData.mat.emissiveIntensity = 0.5;
    }
  }
  if (ringLife > 0) {
    ringLife = Math.max(0, ringLife - dt * 1.7);
    ring.scale.setScalar(0.4 + (1 - ringLife) * 1.8);
    ring.material.opacity = ringLife * 0.75;
    ring.visible = ringLife > 0;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

const bootMode = params.get("mode");
if (bootMode) director.setMode(bootMode);
const seek = Number(params.get("seek") || 0);
if (seek > 0) {
  const n = Math.round(seek * 60);
  for (let i = 0; i < n; i++) consume(director.update(1 / 60));
}
const opening = director.update(0);
consume(opening);
frameCamera(opening, 0, true);
syncButtons();
resize();
animate();

window.__mira = { director, robot, track, scene, camera };
