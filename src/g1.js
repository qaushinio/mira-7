import * as THREE from "three";
import URDFLoader from "urdf-loader";
import { standAngles } from "./g1pose.js";

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

  return {
    kind: "g1",
    root: yawGroup,
    standHeight,
    setRoot(x, y, z, yaw, pitch, roll) {
      yawGroup.position.set(x, y, z);
      yawGroup.rotation.y = yaw;
      tilt.rotation.x = roll;
      tilt.rotation.z = -pitch;
    },
    setAngles,
    tickFace() {},
    setMood() {},
  };
}
