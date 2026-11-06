import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { M } from "./metrics.js";
import { alignDown, scaleBone, solveTwoBone } from "./ik.js";

function box(w, h, d, r = 0.018) {
  const rad = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new RoundedBoxGeometry(w, h, d, 2, rad);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function createRobot() {
  const root = new THREE.Group();
  root.name = "mira";

  const shell = new THREE.MeshStandardMaterial({
    color: 0xe4ddd0,
    roughness: 0.46,
    metalness: 0.08,
    envMapIntensity: 0.55,
  });
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0xf3eee4,
    roughness: 0.34,
    metalness: 0.12,
    envMapIntensity: 0.7,
  });
  const joint = new THREE.MeshStandardMaterial({
    color: 0x2a2e33,
    roughness: 0.34,
    metalness: 0.78,
    envMapIntensity: 0.9,
  });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.92, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x14584c,
    emissive: 0x3dbea5,
    emissiveIntensity: 0.85,
    roughness: 0.4,
    metalness: 0.2,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x14584c,
    emissive: 0x3dbea5,
    emissiveIntensity: 0.9,
    roughness: 0.32,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1c2126,
    roughness: 0.5,
    metalness: 0.35,
  });

  const pelvis = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();
  pelvis.rotation.order = "YXZ";
  torso.rotation.order = "YXZ";
  head.rotation.order = "YXZ";
  root.add(pelvis);
  pelvis.add(torso);
  torso.add(head);

  const pelvisShell = new THREE.Mesh(box(0.16, 0.13, 0.24, 0.03), shell);
  pelvisShell.position.y = 0.06;
  pelvisShell.castShadow = true;
  pelvis.add(pelvisShell);

  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.055, 18), joint);
  waist.position.y = 0.145;
  waist.castShadow = true;
  pelvis.add(waist);

  const rib = new THREE.Mesh(box(0.18, 0.32, 0.3, 0.04), shell);
  rib.position.y = 0.32;
  rib.castShadow = true;
  torso.add(rib);

  const chest = new THREE.Mesh(box(0.04, 0.16, 0.2, 0.016), plateMat);
  chest.position.set(0.09, 0.35, 0);
  chest.castShadow = true;
  torso.add(chest);

  const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.1), ledMat);
  led.position.set(0.112, 0.3, 0);
  torso.add(led);

  const pack = new THREE.Mesh(box(0.07, 0.18, 0.16, 0.016), dark);
  pack.position.set(-0.12, 0.34, 0);
  pack.castShadow = true;
  torso.add(pack);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.046, 0.05, 14), joint);
  neck.position.y = 0.5;
  neck.castShadow = true;
  torso.add(neck);

  head.position.y = 0.53;
  const skull = new THREE.Mesh(box(0.15, 0.17, 0.16, 0.04), shell);
  skull.position.y = 0.09;
  skull.castShadow = true;
  head.add(skull);

  const bezel = new THREE.Mesh(box(0.02, 0.075, 0.12, 0.01), dark);
  bezel.position.set(0.078, 0.09, 0);
  head.add(bezel);

  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = 256;
  faceCanvas.height = 128;
  const faceCtx = faceCanvas.getContext("2d");
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    emissive: 0xffffff,
    emissiveMap: faceTex,
    emissiveIntensity: 0.62,
    roughness: 0.42,
    metalness: 0,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.112, 0.058), faceMat);
  screen.position.set(0.092, 0.092, 0);
  screen.rotation.y = Math.PI / 2;
  head.add(screen);

  for (const z of [-0.09, 0.09]) {
    const ear = new THREE.Mesh(box(0.04, 0.07, 0.025, 0.008), joint);
    ear.position.set(0, 0.1, z);
    ear.castShadow = true;
    head.add(ear);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), accent);
    dot.position.set(0.02, 0.1, z * 1.02);
    head.add(dot);
  }

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.09, 8), joint);
  antenna.position.y = 0.22;
  head.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), accent);
  tip.position.y = 0.27;
  head.add(tip);

  function anchor(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  const hipL = anchor(pelvis, 0, 0, -M.hipZ);
  const hipR = anchor(pelvis, 0, 0, M.hipZ);
  const shL = anchor(torso, 0.02, M.shoulderY, -M.shoulderZ);
  const shR = anchor(torso, 0.02, M.shoulderY, M.shoulderZ);

  function jointBall(parent, r) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), joint);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  jointBall(hipL, 0.048);
  jointBall(hipR, 0.048);
  jointBall(shL, 0.046);
  jointBall(shR, 0.046);

  function limb(nominal, thick, wide) {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(box(thick, nominal, wide, 0.02), shell);
    mesh.castShadow = true;
    mesh.position.y = -nominal / 2;
    pivot.add(mesh);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(Math.max(thick, wide) * 0.46, 16, 12), joint);
    cap.castShadow = true;
    pivot.add(cap);
    root.add(pivot);
    return { pivot, mesh, nominal, cap };
  }

  const thighL = limb(M.thigh, 0.09, 0.1);
  const shinL = limb(M.shin, 0.074, 0.084);
  const thighR = limb(M.thigh, 0.09, 0.1);
  const shinR = limb(M.shin, 0.074, 0.084);
  const armL = limb(M.upper, 0.062, 0.07);
  const foreL = limb(M.fore, 0.052, 0.058);
  const armR = limb(M.upper, 0.062, 0.07);
  const foreR = limb(M.fore, 0.052, 0.058);

  function makeHand(fore) {
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(box(0.046, 0.07, 0.05, 0.012), shell);
    palm.position.set(0.01, -0.04, 0);
    palm.castShadow = true;
    hand.add(palm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 12), joint);
    cuff.position.y = -0.01;
    hand.add(cuff);
    fore.pivot.add(hand);
    return hand;
  }
  const handL = makeHand(foreL);
  const handR = makeHand(foreR);

  function makeFoot() {
    const foot = new THREE.Group();
    const shoe = new THREE.Mesh(box(0.2, 0.032, 0.078, 0.012), shell);
    shoe.position.set(0.042, -0.014, 0);
    shoe.castShadow = true;
    const sole = new THREE.Mesh(box(0.19, 0.012, 0.072, 0.004), soleMat);
    sole.position.set(0.04, -0.03, 0);
    const toe = new THREE.Mesh(box(0.055, 0.026, 0.08, 0.008), dark);
    toe.position.set(0.125, -0.012, 0);
    toe.castShadow = true;
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), joint);
    ankle.castShadow = true;
    foot.add(shoe, sole, toe, ankle);
    root.add(foot);
    return foot;
  }
  const footL = makeFoot();
  const footR = makeFoot();

  const anchors = {
    hipL: new THREE.Vector3(),
    hipR: new THREE.Vector3(),
    shL: new THREE.Vector3(),
    shR: new THREE.Vector3(),
  };
  const mid = new THREE.Vector3();
  const end = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const poleLocal = new THREE.Vector3();
  const hint = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const right = new THREE.Vector3();
  const pole = new THREE.Vector3();

  let mood = "calm";
  let blink = 1;

  function drawFace() {
    const ctx = faceCtx;
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = "#0c1216";
    roundRect(ctx, 0, 0, 256, 128, 26);
    ctx.fill();

    const joy = mood === "joy";
    const air = mood === "air";
    const run = mood === "run";
    ctx.fillStyle = air ? "#ffffff" : "#dfffee";
    ctx.strokeStyle = "#dfffee";
    ctx.lineCap = "round";

    for (const x of [78, 178]) {
      ctx.save();
      ctx.translate(x, 56);
      if (joy) {
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 10, 18, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      } else {
        const ew = air ? 26 : run ? 18 : 22;
        const eh = Math.max(2.2, (air ? 24 : run ? 11 : 18) * blink);
        ctx.beginPath();
        ctx.roundRect(-ew / 2, -eh / 2, ew, eh, Math.min(8, eh / 2));
        ctx.fill();
      }
      ctx.restore();
    }

    if (run) {
      ctx.strokeStyle = "#9ee6d4";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(58, 34);
      ctx.lineTo(96, 40);
      ctx.moveTo(198, 34);
      ctx.lineTo(160, 40);
      ctx.stroke();
    }

    ctx.strokeStyle = "#dfffee";
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (run) {
      ctx.moveTo(112, 96);
      ctx.lineTo(144, 96);
    } else if (joy || air) {
      ctx.moveTo(102, 88);
      ctx.quadraticCurveTo(128, 114, 154, 88);
    } else {
      ctx.moveTo(108, 94);
      ctx.quadraticCurveTo(128, 106, 148, 94);
    }
    ctx.stroke();
    faceTex.needsUpdate = true;
  }

  function placeLimb(origin, target, poleW, upperLen, lowerLen, upper, lower) {
    solveTwoBone(origin, target, poleW, upperLen, lowerLen, mid, end);
    a.copy(origin);
    root.worldToLocal(a);
    b.copy(mid);
    root.worldToLocal(b);
    c.copy(end);
    root.worldToLocal(c);
    poleLocal.copy(poleW);
    root.worldToLocal(poleLocal);
    hint.copy(poleLocal).sub(a);
    const lenU = alignDown(upper.pivot, a, b, hint);
    scaleBone(upper.mesh, upper.nominal, lenU);
    const lenL = alignDown(lower.pivot, b, c, hint);
    scaleBone(lower.mesh, lower.nominal, lenL);
    return { endLocal: c, lenL };
  }

  drawFace();

  return {
    root,
    anchors,
    setBody(spec) {
      root.position.set(spec.x, spec.y, spec.z);
      root.rotation.set(0, spec.yaw, 0);
      pelvis.position.set(spec.pelvisX || 0, spec.pelvisY, spec.pelvisZ || 0);
      pelvis.rotation.set(spec.pelvisPitch || 0, spec.pelvisYaw || 0, spec.pelvisRoll || 0);
      torso.rotation.set(spec.torsoPitch || 0, spec.torsoYaw || 0, spec.torsoRoll || 0);
      head.rotation.set(spec.headPitch || 0, spec.headYaw || 0, spec.headRoll || 0);
    },
    updateMatrices() {
      root.updateMatrixWorld(true);
    },
    readAnchors() {
      hipL.getWorldPosition(anchors.hipL);
      hipR.getWorldPosition(anchors.hipR);
      shL.getWorldPosition(anchors.shL);
      shR.getWorldPosition(anchors.shR);
      const e = root.matrixWorld.elements;
      heading.set(e[0], e[1], e[2]).normalize();
      right.set(e[8], e[9], e[10]).normalize();
      return { heading, right };
    },
    solve(targets) {
      const ax = this.readAnchors();
      const h = ax.heading;
      const r = ax.right;

      pole.copy(anchors.hipL).addScaledVector(h, 0.55);
      pole.y -= 0.12;
      pole.addScaledVector(r, -0.08);
      placeLimb(anchors.hipL, targets.footL, pole, M.thigh, M.shin, thighL, shinL);
      footL.position.copy(c);
      footL.rotation.set(0, 0, targets.footPitchL || 0);

      pole.copy(anchors.hipR).addScaledVector(h, 0.55);
      pole.y -= 0.12;
      pole.addScaledVector(r, 0.08);
      placeLimb(anchors.hipR, targets.footR, pole, M.thigh, M.shin, thighR, shinR);
      footR.position.copy(c);
      footR.rotation.set(0, 0, targets.footPitchR || 0);

      pole.copy(anchors.shL).addScaledVector(h, -0.05);
      pole.y -= 0.28;
      pole.addScaledVector(r, -0.48);
      const leftArm = placeLimb(anchors.shL, targets.handL, pole, M.upper, M.fore, armL, foreL);
      handL.position.y = -leftArm.lenL;

      pole.copy(anchors.shR).addScaledVector(h, -0.05);
      pole.y -= 0.28;
      pole.addScaledVector(r, 0.48);
      const rightArm = placeLimb(anchors.shR, targets.handR, pole, M.upper, M.fore, armR, foreR);
      handR.position.y = -rightArm.lenL;
    },
    setMood(next) {
      mood = next;
    },
    tickFace(time) {
      const x = time % 4.2;
      if (x > 3.85 && x < 4.08) {
        const u = (x - 3.85) / 0.23;
        blink = 0.12 + 0.88 * Math.abs(u - 0.5) * 2;
      } else blink = 1;
      const pulse = 0.75 + Math.sin(time * (mood === "run" ? 7 : 2.4)) * 0.25;
      if (mood === "run") {
        ledMat.emissive.setHex(0xe2a15a);
        ledMat.color.setHex(0x4a3016);
      } else if (mood === "air") {
        ledMat.emissive.setHex(0xf4fff8);
        ledMat.color.setHex(0xdfe8e4);
      } else if (mood === "joy") {
        ledMat.emissive.setHex(0x8dffe4);
        ledMat.color.setHex(0x146056);
      } else {
        ledMat.emissive.setHex(0x3dbea5);
        ledMat.color.setHex(0x14584c);
      }
      ledMat.emissiveIntensity = pulse;
      accent.emissiveIntensity = 0.55 + pulse * 0.4;
      drawFace();
    },
  };
}
