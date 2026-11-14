// Weapons, ballistics and grenades. Damage is checked against bodies by the
// shooter's raycast: headshots pay four times, legs pay less, armour absorbs
// half of what is left. Recoil and spread punish firing on the move and reward
// stopping, crouching and tapping.
import * as THREE from 'three';

export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', price: 0, auto: false, rpm: 320, mag: 12, reserve: 96,
    damage: 34, headMult: 4, range: 40, spread: 0.011, moveSpread: 0.030,
    recoil: 0.006, reload: 1.5, zoom: 1,
  },
  kr7: {
    name: 'KR-7 Carbine', price: 2700, auto: true, rpm: 600, mag: 30, reserve: 90,
    damage: 33, headMult: 4, range: 60, spread: 0.008, moveSpread: 0.026,
    recoil: 0.009, reload: 2.2, zoom: 1,
  },
  vulture: {
    name: 'Vulture DMR', price: 4100, auto: false, rpm: 90, mag: 10, reserve: 40,
    damage: 88, headMult: 4, range: 90, spread: 0.002, moveSpread: 0.05,
    recoil: 0.03, reload: 2.8, zoom: 2.4,
  },
  osprey: {
    name: 'Osprey-12', price: 1900, auto: false, rpm: 75, mag: 8, reserve: 32,
    damage: 12, headMult: 3, range: 22, spread: 0.045, moveSpread: 0.06,
    recoil: 0.022, reload: 2.6, zoom: 1, pellets: 8,
  },
};

export const GRENADES = {
  frag: { name: 'Frag', price: 300 },
  smoke: { name: 'Smoke', price: 300 },
  flash: { name: 'Flash', price: 200 },
};

export const ARMOR_PRICE = 650;

// Spread in radians: base, worse while moving, worse still while airborne,
// better while crouched, and it blooms as a magazine is sprayed.
export function spreadFor(weapon, speed, crouched, bloom) {
  const move = Math.min(1, speed / 4.3);
  let s = weapon.spread + weapon.moveSpread * move + bloom;
  if (crouched) s *= 0.7;
  return s;
}

export function damageFor(weapon, part, distance) {
  const falloff = Math.max(0.45, 1 - Math.max(0, distance - 12) / weapon.range);
  const base = weapon.damage * falloff;
  if (part === 'head') return base * weapon.headMult;
  if (part === 'legs') return base * 0.75;
  return base;
}

// Armour absorbs half the damage until it runs out.
export function applyDamage(actor, raw) {
  let dmg = raw;
  if (actor.armor > 0) {
    const absorbed = Math.min(actor.armor, dmg * 0.5);
    actor.armor -= absorbed;
    dmg -= absorbed;
  }
  actor.hp -= dmg;
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.alive = false;
  }
  return dmg;
}

// A thrown grenade: gravity, one bounce off the ground, then it arms.
export function createGrenade(type, origin, dir) {
  return {
    type,
    pos: origin.clone(),
    vel: new THREE.Vector3(dir.x * 13 + (Math.random() - 0.5), dir.y * 13 + 4.5, dir.z * 13),
    age: 0,
    fuse: type === 'frag' ? 1.4 : 0.9,
    armed: false,
    bounced: false,
  };
}

export function stepGrenade(g, dt, moveBoxes) {
  g.vel.y -= 22 * dt;
  g.pos.addScaledVector(g.vel, dt);
  if (g.pos.y < 0.15 && g.vel.y < 0) {
    g.pos.y = 0.15;
    g.vel.y = -g.vel.y * 0.35;
    g.vel.x *= 0.6;
    g.vel.z *= 0.6;
    g.bounced = true;
  }
  for (const b of moveBoxes) {
    if (g.pos.y < b.h && g.pos.x > b.x0 && g.pos.x < b.x1 && g.pos.z > b.z0 && g.pos.z < b.z1) {
      g.vel.x *= -0.4;
      g.vel.z *= -0.4;
      g.pos.x += g.vel.x * dt * 2;
      g.pos.z += g.vel.z * dt * 2;
    }
  }
  g.age += dt;
  return g.age >= g.fuse;
}

// Is this spot inside a bombsite (for plant / defuse)?
export function siteAt(x, z, sites) {
  for (const [id, s] of Object.entries(sites)) {
    if ((x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r) return id;
  }
  return null;
}
