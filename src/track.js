/** Stadium loop. Dependency-free so the path math can be checked on its own. */

const A = 1.62;
const R = 1.48;

function stadiumPoint(t) {
  const straight = 2 * A;
  const arc = Math.PI * R;
  const total = 2 * straight + 2 * arc;
  let d = ((t % 1) + 1) % 1;
  d *= total;

  if (d < straight) {
    const u = d / straight;
    return { x: -A + 2 * A * u, z: -R };
  }
  d -= straight;
  if (d < arc) {
    const phi = -Math.PI / 2 + (d / arc) * Math.PI;
    return { x: A + R * Math.cos(phi), z: R * Math.sin(phi) };
  }
  d -= arc;
  if (d < straight) {
    const u = d / straight;
    return { x: A - 2 * A * u, z: R };
  }
  d -= straight;
  const phi = Math.PI / 2 + (d / arc) * Math.PI;
  return { x: -A + R * Math.cos(phi), z: R * Math.sin(phi) };
}

export function createTrack() {
  const N = 720;
  const samples = [];
  const cum = [0];
  for (let i = 0; i <= N; i++) samples.push(stadiumPoint(i / N));
  for (let i = 1; i <= N; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dz = samples[i].z - samples[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const length = cum[N];
  const straight = 2 * A;
  const arc = Math.PI * R;
  const hurdles = [straight / 2, straight + arc + straight / 2];

  function pointAt(dist) {
    const L = length;
    let d = ((dist % L) + L) % L;
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const span = cum[i] - cum[i - 1] || 1;
    const u = (d - cum[i - 1]) / span;
    const a = samples[i - 1];
    const b = samples[i];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const mag = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + tx * u,
      z: a.z + tz * u,
      tx: tx / mag,
      tz: tz / mag,
    };
  }

  return { length, hurdles, pointAt, A, R };
}

/** Top-down paint. Plane is rotateX(-PI/2): local +Y lands on world -Z. */
export function paintTrack(ctx, track, world, px) {
  const w = px;
  const h = px;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#12161b";
  ctx.fillRect(0, 0, w, h);

  function project(x, z) {
    const u = (x / world + 0.5) * w;
    const vNorm = -z / world + 0.5;
    const py = (1 - vNorm) * h;
    return [u, py];
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let g = -6; g <= 6; g++) {
    const [x0, y0] = project(g, -6);
    const [x1, y1] = project(g, 6);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const [a0, b0] = project(-6, g);
    const [a1, b1] = project(6, g);
    ctx.beginPath();
    ctx.moveTo(a0, b0);
    ctx.lineTo(a1, b1);
    ctx.stroke();
  }
  ctx.restore();

  const outer = [];
  const inner = [];
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const p = track.pointAt((i / steps) * track.length);
    const rx = -p.tz;
    const rz = p.tx;
    outer.push(project(p.x + rx * 0.52, p.z + rz * 0.52));
    inner.push(project(p.x - rx * 0.52, p.z - rz * 0.52));
  }

  ctx.beginPath();
  outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
  ctx.closePath();
  ctx.fillStyle = "rgba(61, 190, 165, 0.13)";
  ctx.fill();

  ctx.beginPath();
  outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = "rgba(61, 190, 165, 0.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = "rgba(61, 190, 165, 0.35)";
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const p = track.pointAt((i / steps) * track.length);
    const [x, y] = project(p.x, p.z);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.setLineDash([7, 10]);
  ctx.strokeStyle = "rgba(232, 228, 220, 0.28)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  const [cx, cy] = project(0, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232, 228, 220, 0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(232, 228, 220, 0.72)";
  ctx.font = "700 28px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MIRA-7", cx, cy - 6);
  ctx.font = "500 12px Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(232, 228, 220, 0.45)";
  ctx.fillText("SHOWROOM", cx, cy + 16);

  for (const hd of track.hurdles) {
    const p = track.pointAt(hd);
    const rx = -p.tz;
    const rz = p.tx;
    ctx.beginPath();
    const a = project(p.x + rx * 0.62, p.z + rz * 0.62);
    const b = project(p.x - rx * 0.62, p.z - rz * 0.62);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = "rgba(226, 161, 90, 0.9)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}
