/** Shared body measurements, in meters. Forward +X, up +Y, right +Z. */
export const M = {
  thigh: 0.34,
  shin: 0.33,
  ankle: 0.04,
  upper: 0.24,
  fore: 0.22,
  hipZ: 0.096,
  shoulderY: 0.4,
  shoulderZ: 0.185,
  footSide: 0.108,
};

export const STAGE_YAW = -Math.PI / 2;

export function yawFromTangent(tx, tz) {
  return Math.atan2(-tz, tx);
}

export function headingFromYaw(yaw, out) {
  out.set(Math.cos(yaw), 0, -Math.sin(yaw));
  return out;
}

export function rightFromYaw(yaw, out) {
  out.set(Math.sin(yaw), 0, Math.cos(yaw));
  return out;
}

/** Local point (lx forward, ly up, lz right) into world, given a yaw around Y. */
export function toWorld(ox, oy, oz, yaw, lx, ly, lz, out) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.set(ox + c * lx + s * lz, oy + ly, oz - s * lx + c * lz);
  return out;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0 at the start of [a,b], 1 at the end, smoothed. */
export function seg(t, a, b) {
  return smoothstep((t - a) / (b - a));
}
