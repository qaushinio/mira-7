import { clamp, lerp, smoothstep } from "./metrics.js";

const WALK_STANCE = 0.63;
const RUN_STANCE = 0.38;

function anklePitch(hip, knee) {
  return clamp(-(hip + knee), -0.87, 0.52);
}

function leg(angles, side, hip, knee, out = 0.05) {
  const sign = side === "left" ? 1 : -1;
  angles[`${side}_hip_pitch_joint`] = clamp(hip, -2.53, 2.87);
  angles[`${side}_hip_roll_joint`] = clamp(out * sign, side === "left" ? -0.52 : -2.96, side === "left" ? 2.96 : 0.52);
  angles[`${side}_hip_yaw_joint`] = 0;
  angles[`${side}_knee_joint`] = clamp(knee, -0.08, 2.87);
  angles[`${side}_ankle_pitch_joint`] = anklePitch(hip, knee);
  angles[`${side}_ankle_roll_joint`] = clamp(-out * 0.25 * sign, -0.26, 0.26);
}

function arm(angles, side, pitch, out, elbow, yaw = 0) {
  const sign = side === "left" ? 1 : -1;
  angles[`${side}_shoulder_pitch_joint`] = clamp(pitch, -3.08, 2.67);
  angles[`${side}_shoulder_roll_joint`] = clamp(out * sign, side === "left" ? -1.58 : -2.25, side === "left" ? 2.25 : 1.58);
  angles[`${side}_shoulder_yaw_joint`] = clamp(yaw * sign, -2.61, 2.61);
  angles[`${side}_elbow_joint`] = clamp(elbow, -1.04, 2.09);
  angles[`${side}_wrist_roll_joint`] = 0;
}

function relaxArms(angles, pitch = 0.28, elbow = 0.82) {
  arm(angles, "left", pitch, 0.2, elbow);
  arm(angles, "right", pitch, 0.2, elbow);
}

function standLegs(angles, knee = 0.28) {
  leg(angles, "left", 0.06, knee, 0.06);
  leg(angles, "right", 0.06, knee, 0.06);
}

function sidePhase(phase, side) {
  return side === "left" ? phase : (phase + 0.5) % 1;
}

function gaitLeg(angles, side, phase, run) {
  const stance = run ? RUN_STANCE : WALK_STANCE;
  const amp = run ? 1.05 : 0.82;
  const swing = phase >= stance;
  if (!swing) {
    const u = phase / Math.max(stance, 0.001);
    const hip = lerp(0.42, -0.48, u) * amp;
    const knee = 0.22 + Math.sin(u * Math.PI) * (run ? 0.22 : 0.12);
    leg(angles, side, hip, knee, 0.05);
    return;
  }
  const u = (phase - stance) / (1 - stance);
  const lift = Math.sin(u * Math.PI);
  const hip = lerp(-0.48, 0.5, u) * amp;
  const knee = (run ? 0.32 : 0.2) + lift * (run ? 1.25 : 0.85);
  leg(angles, side, hip, knee, 0.06 + lift * 0.05);
}

function gait(angles, ctx) {
  gaitLeg(angles, "left", sidePhase(ctx.phase, "left"), ctx.run);
  gaitLeg(angles, "right", sidePhase(ctx.phase, "right"), ctx.run);
  const cyc = Math.cos(ctx.phase * Math.PI * 2);
  const amp = ctx.run ? 0.72 : 0.42;
  arm(angles, "left", 0.22 + cyc * amp, 0.16, 0.7);
  arm(angles, "right", 0.22 - cyc * amp, 0.16, 0.7);
  angles.waist_yaw_joint = Math.sin(ctx.phase * Math.PI * 2) * (ctx.run ? 0.1 : 0.05);
}

function jump(angles, ctx) {
  if (ctx.jumpState === "crouch") {
    const u = smoothstep(clamp(ctx.jumpT / Math.max(ctx.jumpCrouch, 0.001), 0, 1));
    const hip = lerp(0.12, 0.95, u);
    const knee = lerp(0.3, 1.55, u);
    leg(angles, "left", hip, knee, 0.08);
    leg(angles, "right", hip, knee, 0.08);
    relaxArms(angles, lerp(0.2, 0.95, u), 0.65);
    angles.waist_yaw_joint = 0;
    return;
  }
  if (ctx.jumpState === "air") {
    leg(angles, "left", 1.2, ctx.run ? 2.05 : 1.8, 0.14);
    leg(angles, "right", 1.2, ctx.run ? 2.05 : 1.8, 0.14);
    arm(angles, "left", -0.55, 0.9, 0.5);
    arm(angles, "right", -0.55, 0.9, 0.5);
    angles.waist_yaw_joint = 0;
    return;
  }
  const u = clamp(ctx.jumpT / 0.22, 0, 1);
  const dip = Math.sin(u * Math.PI);
  const hip = lerp(0.7, 0.12, u);
  const knee = 0.35 + dip * 1.05;
  leg(angles, "left", hip, knee, 0.07);
  leg(angles, "right", hip, knee, 0.07);
  relaxArms(angles, 0.45, 0.7);
  angles.waist_yaw_joint = 0;
}

function greet(angles, ctx) {
  standLegs(angles, 0.26);
  const waving = ctx.actTime > 0.55 && ctx.actTime < 2.55;
  arm(angles, "left", 0.35, 0.18, 0.9);
  if (waving) {
    const w = Math.sin(ctx.time * 8);
    arm(angles, "right", -1.05, 1.35, 1.05 + w * 0.2, 0.25);
  } else {
    arm(angles, "right", 0.35, 0.18, 0.9);
  }
  angles.waist_yaw_joint = waving ? -0.45 : -0.28;
}

function dance(angles, ctx) {
  const t = ctx.danceT;
  standLegs(angles);
  relaxArms(angles, 0.15, 0.7);
  angles.waist_yaw_joint = 0;

  if (t >= 0.4 && t < 2.4) {
    const beat = (t - 0.4) / 0.5;
    const i = Math.floor(beat);
    const tap = Math.sin(clamp(beat - i, 0, 1) * Math.PI);
    const liftRight = i % 2 === 0;
    if (liftRight) {
      leg(angles, "left", 0.06, 0.24, 0.1);
      leg(angles, "right", 0.5, 0.65 + tap * 0.4, 0.2);
    } else {
      leg(angles, "right", 0.06, 0.24, 0.1);
      leg(angles, "left", 0.5, 0.65 + tap * 0.4, 0.2);
    }
    const swing = Math.sin(beat * Math.PI);
    arm(angles, "left", 0.05 - swing * 0.35, 0.25, 0.65);
    arm(angles, "right", 0.05 + swing * 0.35, 0.25, 0.65);
    angles.waist_yaw_joint = (liftRight ? -1 : 1) * 0.12 * tap;
    return;
  }
  if (t >= 2.4 && t < 4.4) {
    const w = Math.sin((t - 2.4) * 7.5);
    arm(angles, "left", 0.2, 0.16, 0.85);
    arm(angles, "right", -1.05, 1.35, 0.95 + w * 0.25, 0.25);
    angles.waist_yaw_joint = -0.3 + Math.sin((t - 2.4) * 3) * 0.08;
    return;
  }
  if (t >= 4.4 && t < 5.5) {
    const pop = Math.abs(Math.sin((t - 4.4) * Math.PI * 2));
    arm(angles, "left", -0.85, 0.28, 0.45);
    arm(angles, "right", -0.85, 0.28, 0.45);
    standLegs(angles, 0.24 + pop * 0.08);
    return;
  }
  if (t >= 5.5 && t < 7.15) {
    const u = clamp((t - 5.5) / 1.55, 0, 1);
    const tuck = u < 0.82 ? 1 : clamp(1 - (u - 0.82) / 0.18, 0, 1);
    leg(angles, "left", 0.05, 0.22, 0.06);
    leg(angles, "right", lerp(0.1, 1.25, tuck), lerp(0.25, 1.8, tuck), 0.14);
    arm(angles, "left", -0.15, 1.15, 0.4);
    arm(angles, "right", -0.15, 1.15, 0.4);
    return;
  }
  if (t >= 7.5 && t < 9.5) {
    const beat = (t - 7.5) / 0.5;
    const i = Math.floor(clamp(beat, 0, 3.999));
    const lift = Math.sin(clamp(beat - i, 0, 1) * Math.PI);
    const left = i % 2 === 0;
    if (left) {
      leg(angles, "right", 0.05, 0.3, 0.06);
      leg(angles, "left", 1.15 * lift, 0.3 + 1.5 * lift, 0.1);
      arm(angles, "right", -0.9, 0.2, 0.45);
      arm(angles, "left", 0.35, 0.15, 0.8);
    } else {
      leg(angles, "left", 0.05, 0.3, 0.06);
      leg(angles, "right", 1.15 * lift, 0.3 + 1.5 * lift, 0.1);
      arm(angles, "left", -0.9, 0.2, 0.45);
      arm(angles, "right", 0.35, 0.15, 0.8);
    }
    return;
  }
  if (t >= 9.5 && t < 11.05) {
    if (ctx.air > 0.04) {
      leg(angles, "left", 0.95, 1.55, 0.1);
      leg(angles, "right", 0.95, 1.55, 0.1);
      arm(angles, "left", -1.2, 0.2, 0.4);
      arm(angles, "right", -1.2, 0.2, 0.4);
    } else {
      standLegs(angles, 0.4);
      relaxArms(angles, 0.4, 0.6);
    }
    return;
  }
  if (t >= 11.05 && t < 12.45) {
    standLegs(angles, 0.32);
    arm(angles, "left", 0.55, 0.12, 0.35);
    arm(angles, "right", 0.55, 0.12, 0.35);
    return;
  }
  if (t >= 12.45) {
    standLegs(angles, 0.24);
    arm(angles, "left", -0.35, 0.4, 0.55);
    arm(angles, "right", -0.35, 0.4, 0.55);
  }
}

export function standAngles() {
  const angles = {};
  standLegs(angles);
  relaxArms(angles);
  angles.waist_yaw_joint = 0;
  return angles;
}

export function anglesFor(ctx) {
  const angles = {};
  if (ctx.limbMode === "jump" && ctx.jumpState !== "none") jump(angles, ctx);
  else if (ctx.act === "greet") greet(angles, ctx);
  else if (ctx.act === "dance") dance(angles, ctx);
  else if (ctx.limbMode === "gait") gait(angles, ctx);
  else {
    standLegs(angles);
    relaxArms(angles);
    angles.waist_yaw_joint = 0;
  }
  return angles;
}
