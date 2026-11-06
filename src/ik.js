import * as THREE from "three";

const _v = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _m = new THREE.Matrix4();

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Two-bone IK. Knee/elbow bends toward `pole`.
 * Writes the middle joint and the (possibly clamped) end point.
 */
export function solveTwoBone(hip, target, pole, upper, lower, outMid, outEnd) {
  _v.copy(target).sub(hip);
  let dist = _v.length();
  const max = upper + lower - 1e-4;
  const min = Math.abs(upper - lower) + 1e-3;
  if (dist < 1e-5) {
    _v.set(0, -1, 0);
    dist = min;
  }
  if (dist > max) _v.multiplyScalar(max / dist);
  else if (dist < min) _v.multiplyScalar(min / dist);
  dist = _v.length();
  outEnd.copy(hip).add(_v);

  const cosAng = clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1);
  const ang = Math.acos(cosAng);

  _pole.copy(pole).sub(hip);
  _normal.crossVectors(_v, _pole);
  if (_normal.lengthSq() < 1e-8) _normal.set(0, 0, 1);
  _normal.normalize();
  _bend.crossVectors(_normal, _v).normalize();
  _dir.copy(_v).normalize();

  outMid.copy(hip).addScaledVector(_dir, Math.cos(ang) * upper).addScaledVector(_bend, Math.sin(ang) * upper);
}

/** Point the object's local -Y from `from` toward `to`. Twist follows `hint`. Returns bone length. */
export function alignDown(object, from, to, hint) {
  object.position.copy(from);
  _y.copy(from).sub(to);
  const len = _y.length();
  if (len < 1e-5) return 0;
  _y.multiplyScalar(1 / len);
  _hint.copy(hint);
  if (_hint.lengthSq() < 1e-8) _hint.set(1, 0, 0);
  _hint.normalize();
  _x.crossVectors(_hint, _y);
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1);
  _x.normalize();
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  object.quaternion.setFromRotationMatrix(_m);
  return len;
}

export function scaleBone(mesh, nominal, length) {
  const s = nominal > 1e-5 ? length / nominal : 1;
  mesh.scale.y = s;
  mesh.position.y = -length / 2;
}
