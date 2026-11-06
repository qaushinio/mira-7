import * as THREE from "three";
import URDFLoader from "urdf-loader";
import { standAngles } from "./g1pose.js";

const _axis = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _end = new THREE.Vector3();
const _toEnd = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _sole = new THREE.Vector3();
const _toe = new THREE.Vector3();
const _heel = new THREE.Vector3();
const _outer = new THREE.Vector3();
const _cross = new THREE.Vector3();

function worldAxis(joint) {
  joint.parent.updateWorldMatrix(true, false);
  joint.parent.getWorldQuaternion(_quat);
  _axis.copy(joint.axis);
  if (joint.origQuaternion) _axis.applyQuaternion(joint.origQuaternion);
  _axis.applyQuaternion(_quat);
  return _axis;
}

function bendToward(joint, effector, target) {
  joint.getWorldPosition(_pivot);
  effector.getWorldPosition(_end);
  _toEnd.subVectors(_end, _pivot);
  _toTarget.subVectors(target, _pivot);
  if (_toEnd.lengthSq() < 1e-8 || _toTarget.lengthSq() < 1e-8) return;
  worldAxis(joint);
  _toEnd.addScaledVector(_axis, -_toEnd.dot(_axis));
  _toTarget.addScaledVector(_axis, -_toTarget.dot(_axis));
  if (_toEnd.lengthSq() < 1e-6 || _toTarget.lengthSq() < 1e-6) return;
  _toEnd.normalize();
  _toTarget.normalize();
  _cross.crossVectors(_toEnd, _toTarget);
  const sin = _axis.dot(_cross);
  const cos = THREE.MathUtils.clamp(_toEnd.dot(_toTarget), -1, 1);
  const delta = THREE.MathUtils.clamp(Math.atan2(sin, cos), -0.45, 0.45);
  const current = joint.jointValue?.[0] ?? 0;
  joint.setJointValue(current + delta);
  joint.updateMatrixWorld(true);
}

function marker(parent, point) {
  const node = new THREE.Object3D();
  node.position.copy(point);
  parent.add(node);
  return node;
}

function waitForManager(manager) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    manager.onLoad = finish;
    setTimeout(() => {
      if (manager.itemsTotal > 0 && manager.itemsLoaded >= manager.itemsTotal) finish();
    }, 0);
  });
}

function dress(model) {
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const source = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const sampled = source?.color ? source.color.clone() : new THREE.Color(0xbbbbbb);
    const color = sampled.r > 0.4 ? new THREE.Color(0xe6e2da) : new THREE.Color(0x1a1c1e);
    obj.material = new THREE.MeshStandardMaterial({
      color,
      roughness: sampled.r > 0.4 ? 0.46 : 0.38,
      metalness: sampled.r > 0.4 ? 0.08 : 0.22,
    });
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.geometry && !obj.geometry.getAttribute("normal")) obj.geometry.computeVertexNormals();
  });
}

export async function loadG1() {
  const manager = new THREE.LoadingManager();
  const loader = new URDFLoader(manager);
  const model = await loader.loadAsync(`${import.meta.env.BASE_URL}g1/g1_23dof.urdf`);
  await waitForManager(manager);
  dress(model);

  const yawGroup = new THREE.Group();
  const tilt = new THREE.Group();
  const orient = new THREE.Group();
  orient.rotation.x = -Math.PI / 2;
  yawGroup.add(tilt);
  tilt.add(orient);
  orient.add(model);

  const current = {};
  function setAngles(map, dt) {
    const blend = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
    for (const [name, value] of Object.entries(map)) {
      const prev = current[name] ?? value;
      const next = prev + (value - prev) * blend;
      current[name] = next;
      model.setJointValue(name, next);
    }
  }

  setAngles(standAngles(), 0);
  yawGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(yawGroup);
  const standHeight = Number.isFinite(box.min.y) ? -box.min.y + 0.004 : 0.75;

  const legs = ["left", "right"].map((side) => {
    const link = model.links[`${side}_ankle_roll_link`];
    const footBox = new THREE.Box3().setFromObject(link);
    const midZ = (footBox.min.z + footBox.max.z) / 2;
    const soleW = new THREE.Vector3((footBox.min.x + footBox.max.x) / 2, footBox.min.y, midZ);
    const toeW = new THREE.Vector3(footBox.max.x, footBox.min.y, midZ);
    const heelW = new THREE.Vector3(footBox.min.x, footBox.min.y, midZ);
    const outerW = new THREE.Vector3(soleW.x, footBox.min.y, footBox.min.z);
    const soleL = link.worldToLocal(soleW.clone());
    const toeL = link.worldToLocal(toeW.clone());
    const heelL = link.worldToLocal(heelW.clone());
    const outerL = link.worldToLocal(outerW.clone());
    return {
      side,
      chain: [
        "hip_pitch",
        "hip_roll",
        "hip_yaw",
        "knee",
        "ankle_pitch",
        "ankle_roll",
      ].map((joint) => model.joints[`${side}_${joint}_joint`]),
      anklePitch: model.joints[`${side}_ankle_pitch_joint`],
      ankleRoll: model.joints[`${side}_ankle_roll_joint`],
      sole: marker(link, soleL),
      toe: marker(link, toeL),
      heel: marker(link, heelL),
      outer: marker(link, outerL),
      toeReach: toeW.x - soleW.x,
      heelReach: soleW.x - heelW.x,
      outerReach: soleW.z - outerW.z,
    };
  });

  const legNames = new Set(legs.flatMap((leg) => leg.chain.map((joint) => joint.name)));

  function solveFeet(leftTarget, rightTarget, pitchL, pitchR, heading, right) {
    yawGroup.updateMatrixWorld(true);
    let error = 0;
    for (const [leg, target, pitch] of [
      [legs[0], leftTarget, pitchL],
      [legs[1], rightTarget, pitchR],
    ]) {
      _sole.copy(target);
      const lift = Math.sin(pitch);
      _toe.copy(_sole).addScaledVector(heading, leg.toeReach * Math.cos(pitch));
      _toe.y -= leg.toeReach * lift;
      _heel.copy(_sole).addScaledVector(heading, -leg.heelReach * Math.cos(pitch));
      _heel.y += leg.heelReach * lift;
      _outer.copy(_sole).addScaledVector(right, -leg.outerReach);

      for (let i = 0; i < 7; i++) {
        for (let j = leg.chain.length - 1; j >= 0; j--) bendToward(leg.chain[j], leg.sole, _sole);
      }
      for (let i = 0; i < 4; i++) {
        bendToward(leg.anklePitch, leg.toe, _toe);
        bendToward(leg.anklePitch, leg.heel, _heel);
        bendToward(leg.ankleRoll, leg.outer, _outer);
        bendToward(leg.ankleRoll, leg.sole, _sole);
      }
      const knee = model.joints[`${leg.side}_knee_joint`];
      leg.sole.getWorldPosition(_end);
      error = Math.max(error, _end.distanceTo(_sole));
      current[`${leg.side}_hip_pitch_joint`] = model.joints[`${leg.side}_hip_pitch_joint`].jointValue[0];
      current[`${leg.side}_hip_roll_joint`] = model.joints[`${leg.side}_hip_roll_joint`].jointValue[0];
      current[`${leg.side}_hip_yaw_joint`] = model.joints[`${leg.side}_hip_yaw_joint`].jointValue[0];
      current[`${leg.side}_knee_joint`] = knee.jointValue[0];
      current[`${leg.side}_ankle_pitch_joint`] = leg.anklePitch.jointValue[0];
      current[`${leg.side}_ankle_roll_joint`] = leg.ankleRoll.jointValue[0];
    }
    footError = error;
  }

  let footError = 0;

  return {
    kind: "g1",
    root: yawGroup,
    standHeight,
    get footError() {
      return footError;
    },
    setRoot(x, y, z, yaw, pitch, roll) {
      yawGroup.position.set(x, y, z);
      yawGroup.rotation.y = yaw;
      tilt.rotation.x = roll;
      tilt.rotation.z = -pitch;
    },
    setAngles(map, dt, driveLegs = false) {
      const blend = dt > 0 ? 1 - Math.exp(-18 * dt) : 1;
      for (const [name, value] of Object.entries(map)) {
        if (legNames.has(name) && !driveLegs) continue;
        const prev = current[name] ?? value;
        const next = prev + (value - prev) * blend;
        current[name] = next;
        model.setJointValue(name, next);
      }
    },
    solveFeet,
    tickFace() {},
    setMood() {},
  };
}
