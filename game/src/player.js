// The human player: acceleration-based movement, crouching, collision against
// the map's boxes. No jump — this is a tactical shooter, and stopping to aim
// pays. Speed feeds the weapon's spread, so movement is a gunplay decision.
import * as THREE from 'three';
import { resolveMove } from './map.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
const RADIUS = 0.38;
const WALK_SPEED = 4.3;
const CROUCH_SPEED = 2.2;
const ACCEL = 42;
const FRICTION = 11;

export function createPlayer(moveBoxes) {
  const pos = new THREE.Vector3(0, 0, 12.5);
  const vel = new THREE.Vector3();
  const state = {
    pos, vel, yaw: 0, pitch: 0, // facing north, toward mid
    eye: EYE_STAND, crouched: false, onGround: true,
    hp: 100, armor: 0, alive: true,
  };
  return {
    state,
    reset(x, z, yaw) {
      pos.set(x, 0, z);
      vel.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.eye = EYE_STAND;
      state.crouched = false;
      state.hp = 100;
      state.armor = 0;
      state.alive = true;
    },
    look(dx, dy) {
      state.yaw -= dx * 0.0021;
      state.pitch -= dy * 0.0021;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
    },
    recoil(pitchKick, yawKick) {
      state.pitch += pitchKick;
      state.yaw += yawKick;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
    },
    groundSpeed() {
      return Math.hypot(vel.x, vel.z);
    },
    step(dt, keys) {
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      state.crouched = keys.has('ControlLeft') || keys.has('KeyC');
      const targetEye = state.crouched ? EYE_CROUCH : EYE_STAND;
      state.eye += (targetEye - state.eye) * Math.min(1, dt * 12);
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      // Forward is -Z rotated by yaw; strafe is perpendicular.
      let ax = (-sin * fwd + cos * str) * ACCEL;
      let az = (-cos * fwd - sin * str) * ACCEL;
      const len = Math.hypot(ax, az);
      if (len > ACCEL) { ax = (ax / len) * ACCEL; az = (az / len) * ACCEL; }
      vel.x += ax * dt;
      vel.z += az * dt;
      const fr = Math.max(0, 1 - FRICTION * dt);
      if (fwd === 0 && str === 0) { vel.x *= fr; vel.z *= fr; }
      const max = state.crouched ? CROUCH_SPEED : WALK_SPEED;
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > max) { vel.x = (vel.x / sp) * max; vel.z = (vel.z / sp) * max; }
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      resolveMove(pos, RADIUS, moveBoxes);
    },
  };
}
