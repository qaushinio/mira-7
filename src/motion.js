import * as THREE from "three";
import {
  M,
  STAGE_YAW,
  headingFromYaw,
  rightFromYaw,
  toWorld,
  clamp,
  lerp,
  smoothstep,
  seg,
} from "./metrics.js";

const WALK = {
  name: "walk",
  cadence: 2.05,
  stance: 0.63,
  step: 0.5,
  pelvis: 0.615,
  arm: 0.2,
  lean: 0.08,
  lift: 0.12,
  speed: 2.05 * 0.5,
  hop: { H: 0.52, trigger: 0.334, crouch: 0.18, tuck: 0.3 },
};
const RUN = {
  name: "run",
  cadence: 3.15,
  stance: 0.38,
  step: 0.76,
  pelvis: 0.6,
  arm: 0.3,
  lean: 0.2,
  lift: 0.22,
  speed: 3.15 * 0.76,
  hop: { H: 0.84, trigger: 0.99, crouch: 0.14, tuck: 0.2 },
};

function createGait() {
  const legs = {
    L: { plant: new THREE.Vector3(), next: new THREE.Vector3(), ready: false },
    R: { plant: new THREE.Vector3(), next: new THREE.Vector3(), ready: false },
  };
  let phase = 0;
  let prev = 0;

  function ph(side) {
    return side === "L" ? phase : (phase + 0.5) % 1;
  }
  function pv(side) {
    return side === "L" ? prev : (prev + 0.5) % 1;
  }

  return {
    get phase() {
      return phase;
    },
    reset() {
      phase = 0;
      prev = 0;
      legs.L.ready = false;
      legs.R.ready = false;
    },
    advance(dt, cadence) {
      prev = phase;
      phase = (phase + dt * cadence) % 1;
    },
    feet(ctx, outL, outR) {
      this._leg("L", -1, ctx, outL);
      this._leg("R", 1, ctx, outR);
    },
    _leg(side, sign, ctx, out) {
      const st = legs[side];
      const phaseNow = ph(side);
      const phaseWas = pv(side);
      const sideZ = sign * ctx.footSide;
      if (!st.ready) {
        st.plant.set(
          ctx.rootX + ctx.heading.x * 0.02 + ctx.right.x * sideZ,
          ctx.ankle,
          ctx.rootZ + ctx.heading.z * 0.02 + ctx.right.z * sideZ,
        );
        st.next.copy(st.plant);
        st.ready = true;
      }
      if (phaseNow < phaseWas) st.plant.copy(st.next);
      const wasStance = phaseWas < ctx.stance;
      const inStance = phaseNow < ctx.stance;
      if (wasStance && !inStance) {
        const swingTime = (1 - ctx.stance) / Math.max(ctx.cadence, 0.001);
        const lead = ctx.step * ctx.stance * 0.42;
        const fwd = ctx.step * ctx.cadence * swingTime + lead;
        st.next.set(
          ctx.rootX + ctx.heading.x * fwd + ctx.right.x * sideZ,
          ctx.ankle,
          ctx.rootZ + ctx.heading.z * fwd + ctx.right.z * sideZ,
        );
      }
      if (inStance) {
        out.copy(st.plant);
        out.y = ctx.ankle;
        return;
      }
      const s = (phaseNow - ctx.stance) / (1 - ctx.stance);
      const ease = s * s * (3 - 2 * s);
      out.lerpVectors(st.plant, st.next, ease);
      out.y = ctx.ankle + Math.sin(Math.PI * s) * ctx.lift;
    },
  };
}

function footPitchFor(phase, stance, run) {
  const heel = run ? 0.12 : 0.4;
  const toe = run ? 0.32 : 0.62;
  const ph = phase < stance ? phase : null;
  if (ph !== null) {
    const u = stance > 0 ? ph / stance : 0;
    if (u < 0.18) return -heel * (1 - u / 0.18);
    if (u > 0.72) return toe * ((u - 0.72) / 0.28);
    return 0;
  }
  const s = (phase - stance) / (1 - stance);
  if (s < 0.5) return lerp(toe * 0.7, -0.48, s / 0.5);
  return lerp(-0.48, -heel * 0.8, (s - 0.5) / 0.5);
}

function passed(p0, p1, mark) {
  if (p1 >= p0) return p0 < mark && p1 >= mark;
  return p0 < mark || p1 >= mark;
}

export function createDirector(track, robot) {
  const gait = createGait();
  const spec = {};
  const targets = {
    footL: new THREE.Vector3(),
    footR: new THREE.Vector3(),
    handL: new THREE.Vector3(),
    handR: new THREE.Vector3(),
    footPitchL: 0,
    footPitchR: 0,
  };
  const shownL = new THREE.Vector3();
  const shownR = new THREE.Vector3();
  const smoothL = new THREE.Vector3();
  const smoothR = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tuckL = new THREE.Vector3();
  const tuckR = new THREE.Vector3();
  const groundL = new THREE.Vector3();
  const groundR = new THREE.Vector3();

  const start = track.pointAt(0);
  let x = start.x;
  let y = 0;
  let z = start.z;
  let yaw = Math.atan2(-start.tz, start.tx);
  let s = 0;
  let prevS = 0;
  let lap = 0;
  let onTrack = true;
  let mode = "show";
  let act = "greet";
  let actTime = 0;
  let time = 0;
  let limbMode = "custom";
  let gaitParams = WALK;
  let caption = "Saying hello.";
  let kicker = "HELLO";
  let framing = "follow";
  let mood = "calm";
  let handsInit = false;
  let pitchL = 0;
  let pitchR = 0;
  const events = [];
  const used = new Set();
  const remain = { left: 0 };
  let transit = null;
  let transitDone = null;
  const dance = {
    t: 0,
    plantL: new THREE.Vector3(),
    plantR: new THREE.Vector3(),
    fromL: new THREE.Vector3(),
    fromR: new THREE.Vector3(),
  };
  const jump = {
    state: "none",
    t: 0,
    vy: 0,
    index: -1,
    flashed: false,
    cooldown: 0,
    hop: WALK.hop,
    speed: WALK.speed,
    isRun: false,
    captureL: new THREE.Vector3(),
    captureR: new THREE.Vector3(),
    pinL: new THREE.Vector3(),
    pinR: new THREE.Vector3(),
    airL: new THREE.Vector3(),
    airR: new THREE.Vector3(),
  };

  const entryS = (track.hurdles[0] - 3.5 + track.length) % track.length;

  function clearSpec() {
    spec.pelvisX = 0;
    spec.pelvisY = 0.66;
    spec.pelvisZ = 0;
    spec.pelvisPitch = 0;
    spec.pelvisYaw = 0;
    spec.pelvisRoll = 0;
    spec.torsoPitch = 0;
    spec.torsoYaw = 0;
    spec.torsoRoll = 0;
    spec.headPitch = 0;
    spec.headYaw = 0;
    spec.headRoll = 0;
  }

  function cancelJump() {
    jump.state = "none";
    jump.vy = 0;
    jump.t = 0;
    y = 0;
  }

  function closestS(px, pz) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 240; i++) {
      const d = (i / 240) * track.length;
      const p = track.pointAt(d);
      const dd = (p.x - px) ** 2 + (p.z - pz) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  function startTransit(tx, tz, done) {
    transit = { x: tx, z: tz };
    transitDone = done;
    act = "transit";
    onTrack = false;
    cancelJump();
    gait.reset();
    handsInit = false;
  }

  function beginDance() {
    dance.t = 0;
    toWorld(0, 0, 0, STAGE_YAW, 0.02, M.ankle, -M.footSide, dance.plantL);
    toWorld(0, 0, 0, STAGE_YAW, 0.02, M.ankle, M.footSide, dance.plantR);
    dance.fromL.copy(shownL);
    dance.fromR.copy(shownR);
    act = "dance";
    onTrack = false;
    y = 0;
    cancelJump();
  }

  function startJump(index, params) {
    jump.state = "crouch";
    jump.t = 0;
    jump.index = index;
    jump.flashed = false;
    jump.hop = params.hop;
    jump.speed = params.speed;
    jump.isRun = params === RUN;
    jump.captureL.copy(shownL);
    jump.captureR.copy(shownR);
    toWorld(x, 0, z, yaw, 0, M.ankle, -M.footSide, jump.pinL);
    toWorld(x, 0, z, yaw, 0, M.ankle, M.footSide, jump.pinR);
    used.add(`${lap}:${index}`);
  }

  function maybeStartJump(params) {
    if (jump.state !== "none" || jump.cooldown > 0) return;
    for (let i = 0; i < track.hurdles.length; i++) {
      let ahead = track.hurdles[i] - s;
      ahead = ((ahead % track.length) + track.length) % track.length;
      if (ahead < params.hop.trigger && ahead > 0.08 && !used.has(`${lap}:${i}`)) {
        startJump(i, params);
        break;
      }
    }
  }

  function tickJump(dt) {
    if (jump.cooldown > 0) jump.cooldown -= dt;
    if (jump.state === "land" && jump.t > 0.22) {
      jump.state = "none";
      jump.cooldown = 0.3;
      gait.reset();
      y = 0;
      return;
    }
    if (jump.state === "crouch") {
      jump.t += dt;
      if (jump.t >= jump.hop.crouch) {
        jump.state = "air";
        jump.t = 0;
        jump.vy = Math.sqrt(2 * 9.8 * jump.hop.H);
      }
    } else if (jump.state === "air") {
      jump.t += dt;
      jump.vy -= 9.8 * dt;
      y += jump.vy * dt;
      if (y <= 0 && jump.t > 0.08) {
        y = 0;
        jump.vy = 0;
        jump.state = "land";
        jump.t = 0;
        jump.airL.copy(shownL);
        jump.airR.copy(shownR);
        if (jump.index >= 0) {
          let ahead = track.hurdles[jump.index] - s;
          ahead = ((ahead % track.length) + track.length) % track.length;
          if (ahead > 0.2 && ahead < 2.4) used.delete(`${lap}:${jump.index}`);
        }
        events.push({ type: "land", x, z });
      }
    } else if (jump.state === "land") {
      jump.t += dt;
    }
  }

  function locomote(dt, params, remaining, allowJumps) {
    gaitParams = params;
    if (allowJumps) maybeStartJump(params);
    tickJump(dt);
    let speed = params.speed;
    if (jump.state === "crouch") speed = 0;
    else if (jump.state === "land") speed = params.speed * 0.55;
    let ds = speed * dt;
    if (remaining) {
      if (remaining.left <= 0) ds = 0;
      else {
        ds = Math.min(ds, remaining.left);
        remaining.left -= ds;
      }
    }
    prevS = s;
    s = (s + ds) % track.length;
    if (s < prevS - 0.25) lap += 1;
    if (jump.state === "air" && !jump.flashed && jump.index >= 0) {
      const mark = track.hurdles[jump.index];
      if (passed(prevS, s, mark)) {
        jump.flashed = true;
        events.push({ type: "clear", index: jump.index });
      }
    }
    const p = track.pointAt(s);
    x = p.x;
    z = p.z;
    yaw = Math.atan2(-p.tz, p.tx);
    onTrack = true;
    limbMode = jump.state === "none" ? "gait" : "jump";
    if (remaining && remaining.left <= 0.001 && jump.state === "none") return true;
    return false;
  }

  function followTransit(dt) {
    gaitParams = WALK;
    const dx = transit.x - x;
    const dz = transit.z - z;
    const dist = Math.hypot(dx, dz);
    const speed = WALK.speed;
    if (dist <= Math.max(0.045, speed * dt)) {
      x = transit.x;
      z = transit.z;
      const done = transitDone;
      transit = null;
      transitDone = null;
      limbMode = "gait";
      done?.();
      return;
    }
    const hx = dx / dist;
    const hz = dz / dist;
    x += hx * speed * dt;
    z += hz * speed * dt;
    yaw = Math.atan2(-hz, hx);
    y = 0;
    limbMode = "gait";
    caption = "Walking over.";
    kicker = "WALK";
    mood = "focus";
    framing = "follow";
  }

  function writeGaitBody(params) {
    const phase = gait.phase;
    const run = params === RUN;
    const sway = -Math.sin(phase * Math.PI * 2) * (run ? 0.042 : 0.03);
    const vault = Math.abs(Math.sin(phase * Math.PI * 2));
    spec.pelvisY = params.pelvis - (1 - vault) * (run ? 0.032 : 0.02);
    spec.pelvisZ = sway;
    spec.pelvisX = Math.sin(phase * Math.PI * 2) * 0.014;
    spec.pelvisRoll = sway * 2.15;
    spec.pelvisPitch = params.lean * 0.25;
    spec.torsoRoll = -sway * 3.1;
    spec.torsoYaw = Math.sin(phase * Math.PI * 2) * (run ? 0.08 : 0.05);
    spec.torsoPitch = params.lean;
    spec.headPitch = -params.lean * 0.45;
    spec.headYaw = -spec.torsoYaw * 0.7;
  }

  function writeJumpBody() {
    const base = jump.isRun ? RUN.pelvis : WALK.pelvis;
    const lean = jump.isRun ? 0.2 : 0.1;
    if (jump.state === "crouch") {
      const u = smoothstep(Math.min(1, jump.t / jump.hop.crouch));
      spec.pelvisY = lerp(base, base - 0.14, u);
      spec.torsoPitch = lerp(lean, 0.38, u);
      spec.headPitch = -0.05;
    } else if (jump.state === "air") {
      const u = smoothstep(Math.min(1, jump.t / 0.12));
      spec.pelvisY = lerp(base - 0.12, base + 0.03, u);
      spec.torsoPitch = lerp(0.34, -0.12, u);
      spec.headPitch = lerp(0.05, -0.15, u);
    } else {
      const dip = Math.sin(Math.min(1, jump.t / 0.22) * Math.PI);
      spec.pelvisY = base - dip * 0.1;
      spec.torsoPitch = 0.22 * (1 - jump.t / 0.22);
      spec.headPitch = 0.04;
    }
  }

  function gaitHands(params) {
    const cyc = Math.cos(gait.phase * Math.PI * 2);
    const amp = params.arm;
    const drop = params === RUN ? 0.3 : 0.36;
    const run = params === RUN;
    const aL = robot.anchors;
    targets.handL.copy(aL.shL);
    targets.handL.addScaledVector(heading, -cyc * amp - 0.03);
    targets.handL.addScaledVector(right, run ? -0.2 : -0.17);
    targets.handL.y -= drop;
    targets.handR.copy(aL.shR);
    targets.handR.addScaledVector(heading, cyc * amp - 0.03);
    targets.handR.addScaledVector(right, run ? 0.2 : 0.17);
    targets.handR.y -= drop;
    const pL = gait.phase;
    const pR = (gait.phase + 0.5) % 1;
    targets.footPitchL = footPitchFor(pL, params.stance, run);
    targets.footPitchR = footPitchFor(pR, params.stance, run);
  }

  function jumpHands() {
    const aL = robot.anchors;
    let fwd = 0.08;
    let drop = -0.05;
    let spread = 0.2;
    if (jump.state === "crouch") {
      fwd = -0.2;
      drop = -0.34;
      spread = 0.16;
      targets.footPitchL = 0.25;
      targets.footPitchR = 0.25;
    } else if (jump.state === "air") {
      fwd = 0.08;
      drop = 0.2;
      spread = 0.22;
      targets.footPitchL = -0.35;
      targets.footPitchR = -0.35;
    } else {
      fwd = 0.18;
      drop = -0.22;
      spread = 0.16;
      targets.footPitchL = 0.1;
      targets.footPitchR = 0.1;
    }
    targets.handL.copy(aL.shL).addScaledVector(heading, fwd).addScaledVector(right, -spread);
    targets.handL.y += drop;
    targets.handR.copy(aL.shR).addScaledVector(heading, fwd).addScaledVector(right, spread);
    targets.handR.y += drop;
  }

  function jumpFeet() {
    if (jump.state === "crouch") {
      const u = smoothstep(Math.min(1, jump.t / (jump.hop.crouch * 0.9)));
      targets.footL.lerpVectors(jump.captureL, jump.pinL, u);
      targets.footR.lerpVectors(jump.captureR, jump.pinR, u);
      targets.footL.y = M.ankle;
      targets.footR.y = M.ankle;
      return;
    }
    if (jump.state === "air") {
      const k = smoothstep(Math.min(1, jump.t / 0.1));
      const tuck = jump.hop.tuck;
      tuckL.copy(robot.anchors.hipL).addScaledVector(heading, 0.06);
      tuckL.y -= tuck;
      tuckR.copy(robot.anchors.hipR).addScaledVector(heading, 0.06);
      tuckR.y -= tuck;
      targets.footL.lerpVectors(jump.pinL, tuckL, k);
      targets.footR.lerpVectors(jump.pinR, tuckR, k);
      return;
    }
    const u = smoothstep(Math.min(1, jump.t / 0.16));
    toWorld(x, 0, z, yaw, 0.03, M.ankle, -M.footSide, groundL);
    toWorld(x, 0, z, yaw, 0.03, M.ankle, M.footSide, groundR);
    targets.footL.lerpVectors(jump.airL, groundL, u);
    targets.footR.lerpVectors(jump.airR, groundR, u);
    targets.footL.y = lerp(jump.airL.y, M.ankle, u);
    targets.footR.y = lerp(jump.airR.y, M.ankle, u);
  }

  function poseGreet() {
    y = 0;
    const breathe = Math.sin(time * 1.6);
    spec.pelvisY = 0.67 + breathe * 0.006;
    spec.torsoPitch = breathe * 0.012;
    spec.torsoYaw = -0.12;
    spec.headYaw = -0.22 + Math.sin(time * 0.55) * 0.05;
    spec.headPitch = -0.04;
    toWorld(x, 0, z, yaw, 0.02, M.ankle, -M.footSide, targets.footL);
    toWorld(x, 0, z, yaw, 0.02, M.ankle, M.footSide, targets.footR);
    toWorld(x, 0, z, yaw, 0.08, 0.74, -0.22, targets.handL);
    const waving = actTime > 0.55 && actTime < 2.55;
    if (waving) {
      const w = Math.sin(time * 8);
      toWorld(x, 0, z, yaw, 0.08, 1.38 + w * 0.04, 0.46, targets.handR);
      spec.torsoYaw = -0.16;
      spec.headYaw = -0.28;
    } else {
      toWorld(x, 0, z, yaw, 0.08, 0.74, 0.22, targets.handR);
    }
    targets.footPitchL = 0;
    targets.footPitchR = 0;
    limbMode = "custom";
    mood = waving ? "joy" : "calm";
    caption = "Saying hello.";
    kicker = "HELLO";
    framing = "follow";
  }

  function poseDance(dt) {
    dance.t += dt;
    const t = dance.t;
    rightFromYaw(STAGE_YAW, right);
    headingFromYaw(STAGE_YAW, heading);
    y = 0;
    yaw = STAGE_YAW;
    x = 0;
    z = 0;
    clearSpec();
    spec.pelvisY = 0.66 + Math.sin(t * 6) * 0.008;
    const blend = seg(t, 0, 0.28);
    targets.footL.lerpVectors(dance.fromL, dance.plantL, blend);
    targets.footR.lerpVectors(dance.fromR, dance.plantR, blend);
    targets.footPitchL = 0;
    targets.footPitchR = 0;
    toWorld(0, 0, 0, STAGE_YAW, 0.08, 0.76, -0.22, targets.handL);
    toWorld(0, 0, 0, STAGE_YAW, 0.08, 0.76, 0.22, targets.handR);
    caption = "Finding the beat.";
    kicker = "DANCE";
    mood = "joy";
    framing = "stage";

    if (t >= 0.4 && t < 2.4) {
      const beat = (t - 0.4) / 0.5;
      const i = Math.floor(beat);
      const f = beat - i;
      const tap = Math.sin(clamp(f, 0, 1) * Math.PI);
      const dir = i % 2 === 0 ? 1 : -1;
      const shift = -dir * 0.045 * tap;
      x = right.x * shift;
      z = right.z * shift;
      spec.pelvisRoll = -dir * 0.08 * tap;
      spec.torsoRoll = dir * 0.06 * tap;
      spec.pelvisY = 0.655;
      if (dir > 0) {
        targets.footL.copy(dance.plantL);
        toWorld(0, 0, 0, STAGE_YAW, 0.02, M.ankle + 0.05 * tap, M.footSide + 0.14 * tap, targets.footR);
        targets.footPitchR = -0.25 * tap;
      } else {
        targets.footR.copy(dance.plantR);
        toWorld(0, 0, 0, STAGE_YAW, 0.02, M.ankle + 0.05 * tap, -M.footSide - 0.14 * tap, targets.footL);
        targets.footPitchL = -0.25 * tap;
      }
      const arm = Math.sin(beat * Math.PI);
      toWorld(x, 0, z, STAGE_YAW, 0.12 * arm, 0.9, -0.24, targets.handL);
      toWorld(x, 0, z, STAGE_YAW, -0.12 * arm, 0.9, 0.24, targets.handR);
      caption = "Step touch. Weight shifts, the free foot taps out.";
    } else if (t >= 2.4 && t < 4.4) {
      const w = Math.sin((t - 2.4) * 7.5);
      toWorld(0, 0, 0, STAGE_YAW, 0.1, 1.4 + w * 0.05, 0.42 + Math.cos((t - 2.4) * 7.5) * 0.06, targets.handR);
      toWorld(0, 0, 0, STAGE_YAW, 0.02, 0.9, -0.2, targets.handL);
      spec.headYaw = -0.15;
      spec.torsoYaw = Math.sin((t - 2.4) * 3) * 0.08;
      caption = "Wave.";
    } else if (t >= 4.4 && t < 5.5) {
      const pop = Math.abs(Math.sin((t - 4.4) * Math.PI * 2));
      spec.torsoPitch = -0.12 * pop;
      spec.pelvisY = 0.66 + 0.02 * pop;
      toWorld(0, 0, 0, STAGE_YAW, 0.24, 0.98 + 0.06 * pop, -0.16, targets.handL);
      toWorld(0, 0, 0, STAGE_YAW, 0.24, 0.98 + 0.06 * pop, 0.16, targets.handR);
      caption = "Chest pop.";
    } else if (t >= 5.5 && t < 7.15) {
      const u = seg(t, 5.5, 7.05);
      const angle = u * Math.PI * 2;
      yaw = STAGE_YAW + angle;
      const lx = 0.02;
      const lz = -M.footSide;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      x = dance.plantL.x - (c * lx + sn * lz);
      z = dance.plantL.z - (-sn * lx + c * lz);
      targets.footL.copy(dance.plantL);
      const tuck = u < 0.82 ? 1 : clamp(1 - (u - 0.82) / 0.18, 0, 1);
      toWorld(x, 0, z, yaw, 0.08, M.ankle + 0.3 * tuck, 0.1, targets.footR);
      targets.footPitchR = -0.4 * tuck;
      toWorld(x, 0, z, yaw, 0.06, 1.05, -0.56, targets.handL);
      toWorld(x, 0, z, yaw, 0.06, 1.05, 0.56, targets.handR);
      spec.pelvisY = 0.67;
      caption = "Spin, standing on one foot.";
    } else if (t >= 7.15 && t < 7.5) {
      caption = "Spin, standing on one foot.";
    } else if (t >= 7.5 && t < 9.5) {
      const beat = (t - 7.5) / 0.5;
      const i = Math.floor(clamp(beat, 0, 3.999));
      const f = beat - i;
      const lift = Math.sin(clamp(f, 0, 1) * Math.PI);
      const left = i % 2 === 0;
      spec.torsoPitch = 0.1;
      spec.pelvisY = 0.64;
      spec.pelvisRoll = (left ? -1 : 1) * 0.05 * lift;
      if (left) {
        targets.footR.copy(dance.plantR);
        toWorld(0, 0, 0, STAGE_YAW, 0.1, M.ankle + 0.34 * lift, -M.footSide, targets.footL);
        targets.footPitchL = -0.5 * lift;
        toWorld(0, 0, 0, STAGE_YAW, -0.08, 0.78, -0.2, targets.handL);
        toWorld(0, 0, 0, STAGE_YAW, 0.22, 1.02, 0.16, targets.handR);
      } else {
        targets.footL.copy(dance.plantL);
        toWorld(0, 0, 0, STAGE_YAW, 0.1, M.ankle + 0.34 * lift, M.footSide, targets.footR);
        targets.footPitchR = -0.5 * lift;
        toWorld(0, 0, 0, STAGE_YAW, 0.22, 1.02, -0.16, targets.handL);
        toWorld(0, 0, 0, STAGE_YAW, -0.08, 0.78, 0.2, targets.handR);
      }
      const shift = (left ? -1 : 1) * 0.03 * lift;
      x = right.x * shift;
      z = right.z * shift;
      caption = "High knees.";
    } else if (t >= 9.5 && t < 11.05) {
      const hopAt = (t0) => {
        const u = t - t0;
        if (u < 0 || u > 0.42) return 0;
        return Math.max(0, 2.2 * u - 0.5 * 9.8 * u * u);
      };
      y = hopAt(9.55) + hopAt(10.15);
      const prep = (t0) => {
        const u = t0 - t;
        return u > 0 && u < 0.1 ? (0.1 - u) / 0.1 : 0;
      };
      const prepAmt = Math.max(prep(9.55), prep(10.15));
      spec.pelvisY = 0.66 - prepAmt * 0.1 + Math.min(0.03, y);
      toWorld(0, 0, 0, STAGE_YAW, 0.04, M.ankle + y * 0.92, -M.footSide, targets.footL);
      toWorld(0, 0, 0, STAGE_YAW, 0.04, M.ankle + y * 0.92, M.footSide, targets.footR);
      const up = y > 0.04 ? 1 : 0;
      toWorld(0, 0, 0, STAGE_YAW, 0.1, 0.9 + up * 0.35, -0.24, targets.handL);
      toWorld(0, 0, 0, STAGE_YAW, 0.1, 0.9 + up * 0.35, 0.24, targets.handR);
      if (y > 0.04) mood = "air";
      caption = "Two hops.";
    } else if (t >= 11.05 && t < 12.45) {
      const into = seg(t, 11.05, 11.55);
      const out = seg(t, 11.7, 12.35);
      const bow = into * (1 - out);
      spec.torsoPitch = lerp(0, 0.85, bow);
      spec.headPitch = lerp(0, 0.15, bow);
      spec.pelvisY = 0.66 - bow * 0.04;
      const hy = lerp(0.78, 0.62, bow);
      const hx = lerp(0.05, -0.12, bow);
      const spread = lerp(0.22, 0.18, bow);
      toWorld(0, 0, 0, STAGE_YAW, lerp(hx, 0.24, out), lerp(hy, 1.0, out), -lerp(spread, 0.34, out), targets.handL);
      toWorld(0, 0, 0, STAGE_YAW, lerp(hx, 0.24, out), lerp(hy, 1.0, out), lerp(spread, 0.34, out), targets.handR);
      caption = out > 0.2 ? "There you go." : "Bow.";
    } else if (t >= 12.45) {
      spec.pelvisY = 0.665;
      spec.headYaw = 0.08;
      toWorld(0, 0, 0, STAGE_YAW, 0.22, 1.0, -0.34, targets.handL);
      toWorld(0, 0, 0, STAGE_YAW, 0.22, 1.0, 0.34, targets.handR);
      caption = "Hold.";
    }
    limbMode = "custom";
  }

  function captionsForLoco(params) {
    if (jump.state !== "none") {
      kicker = "JUMP";
      mood = jump.state === "air" ? "air" : "run";
      caption = jump.isRun
        ? "Jumping the hurdle. Knees tuck, then the bar goes by underneath."
        : "Hopping the bar. Both feet leave the floor.";
      return;
    }
    if (params === RUN) {
      kicker = "RUN";
      mood = "run";
      caption = "Running the round. There's a beat where neither foot is down.";
    } else {
      kicker = "WALK";
      mood = "focus";
      caption = "Walking the loop. The stance foot stays planted.";
    }
    framing = "follow";
  }

  function finalize(dt) {
    if (limbMode === "gait") {
      gait.advance(dt, gaitParams.cadence);
      writeGaitBody(gaitParams);
    } else if (limbMode === "jump") {
      writeJumpBody();
    }
    spec.x = x;
    spec.y = y;
    spec.z = z;
    spec.yaw = yaw;
    robot.setBody(spec);
    robot.updateMatrices();
    const axes = robot.readAnchors();
    heading.copy(axes.heading);
    right.copy(axes.right);

    if (limbMode === "gait") {
      gait.feet(
        {
          stance: gaitParams.stance,
          step: gaitParams.step,
          cadence: gaitParams.cadence,
          heading,
          right,
          rootX: x,
          rootZ: z,
          ankle: M.ankle,
          lift: gaitParams.lift,
          footSide: M.footSide,
        },
        targets.footL,
        targets.footR,
      );
      gaitHands(gaitParams);
    } else if (limbMode === "jump") {
      jumpFeet();
      jumpHands();
    }

    if (!handsInit || dt <= 0) {
      smoothL.copy(targets.handL);
      smoothR.copy(targets.handR);
      pitchL = targets.footPitchL;
      pitchR = targets.footPitchR;
      handsInit = true;
    } else {
      const a = 1 - Math.exp(-16 * dt);
      smoothL.lerp(targets.handL, a);
      smoothR.lerp(targets.handR, a);
      pitchL = lerp(pitchL, targets.footPitchL, a);
      pitchR = lerp(pitchR, targets.footPitchR, a);
    }
    targets.handL.copy(smoothL);
    targets.handR.copy(smoothR);
    targets.footPitchL = pitchL;
    targets.footPitchR = pitchR;
    robot.solve(targets);
    robot.setMood(mood);
    shownL.copy(targets.footL);
    shownR.copy(targets.footR);
  }

  function runShow(dt) {
    if (act === "greet") {
      actTime += dt;
      poseGreet();
      if (actTime > 3.25) {
        act = "walklap";
        remain.left = track.length;
        gait.reset();
        handsInit = false;
      }
      return;
    }
    if (act === "walklap") {
      const done = locomote(dt, WALK, remain, true);
      captionsForLoco(WALK);
      if (done) startTransit(0, 0, () => beginDance());
      return;
    }
    if (act === "transit") {
      followTransit(dt);
      return;
    }
    if (act === "dance") {
      poseDance(dt);
      if (dance.t > 13.15) {
        const p = track.pointAt(entryS);
        startTransit(p.x, p.z, () => {
          s = entryS;
          prevS = entryS;
          onTrack = true;
          act = "runlaps";
          remain.left = track.length * 2;
          gait.reset();
          x = p.x;
          z = p.z;
          yaw = Math.atan2(-p.tz, p.tx);
        });
      }
      return;
    }
    if (act === "runlaps") {
      const done = locomote(dt, RUN, remain, true);
      captionsForLoco(RUN);
      if (done) {
        act = "home";
        remain.left = (track.length - s) % track.length;
        gait.reset();
      }
      return;
    }
    if (act === "home") {
      const done = locomote(dt, WALK, remain, false);
      caption = "Back to the start.";
      kicker = "WALK";
      mood = "focus";
      framing = "follow";
      if (done) {
        act = "greet";
        actTime = 0;
        gait.reset();
        handsInit = false;
      }
    }
  }

  function ensureTrack(params, nextAct) {
    if (onTrack && Math.hypot(track.pointAt(s).x - x, track.pointAt(s).z - z) < 0.2) {
      act = nextAct;
      gait.reset();
      return;
    }
    const cs = closestS(x, z);
    const p = track.pointAt(cs);
    startTransit(p.x, p.z, () => {
      s = cs;
      prevS = cs;
      onTrack = true;
      act = nextAct;
      gait.reset();
      x = p.x;
      z = p.z;
      const q = track.pointAt(cs);
      yaw = Math.atan2(-q.tz, q.tx);
    });
    gaitParams = params;
  }

  return {
    update(dt) {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.033) : 0;
      time += step;
      events.length = 0;
      clearSpec();
      if (mode === "show") runShow(step);
      else if (mode === "dance") {
        if (act === "transit") followTransit(step);
        else if (act === "dance") poseDance(step);
        else beginDance();
      } else {
        const params = mode === "run" ? RUN : WALK;
        if (act === "transit") followTransit(step);
        else {
          locomote(step, params, null, true);
          captionsForLoco(params);
        }
      }
      finalize(step);
      robot.tickFace(time);
      return {
        caption,
        kicker,
        mode,
        events,
        framing,
        x,
        y,
        z,
        yaw,
        hx: Math.cos(yaw),
        hz: -Math.sin(yaw),
        rx: Math.sin(yaw),
        rz: Math.cos(yaw),
        debug: `mode ${mode} act ${act} s ${s.toFixed(2)} y ${y.toFixed(2)} jump ${jump.state} phase ${gait.phase.toFixed(2)}`,
      };
    },
    setMode(next) {
      if (!["show", "walk", "run", "dance"].includes(next)) return;
      mode = next;
      cancelJump();
      handsInit = false;
      actTime = 0;
      used.clear();
      if (next === "show") {
        if (onTrack) {
          act = "home";
          remain.left = (track.length - s) % track.length;
          if (remain.left < 0.08) {
            act = "greet";
            actTime = 0;
          }
        } else {
          const p = track.pointAt(0);
          startTransit(p.x, p.z, () => {
            s = 0;
            prevS = 0;
            onTrack = true;
            act = "greet";
            actTime = 0;
            x = p.x;
            z = p.z;
            yaw = Math.atan2(-p.tz, p.tx);
          });
        }
        return;
      }
      if (next === "dance") {
        if (Math.hypot(x, z) < 0.12) beginDance();
        else startTransit(0, 0, () => beginDance());
        return;
      }
      ensureTrack(next === "run" ? RUN : WALK, "loco");
    },
    get mode() {
      return mode;
    },
  };
}
