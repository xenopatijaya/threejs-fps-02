// Bot AI: nine fighters that route through the map, hold positions, react to
// what they see and hear, and play the objective. Attackers pick a site and
// push it; the carrier plants when the site is clear. Defenders hold sites
// and rotate to gunfire, plants and the planted bomb.
import * as THREE from 'three';
import { createFighter, hitMeshes } from './characters.js';
import { findPath, nearestWaypoint, hasLOS } from './map.js';
import { resolveMove } from './map.js';
import { WEAPONS, applyDamage } from './weapons.js';

const BOT_NAMES = {
  lanterns: ['Ember', 'Kite', 'Rook', 'Sable'],
  harbour: ['Tide', 'Warden', 'Reef', 'Cinder'],
};
const ENEMY_NAMES = {
  lanterns: ['Ash', 'Flint', 'Coal', 'Smoulder', 'Gale'],
  harbour: ['Breaker', 'Anchor', 'Harbor', 'Sentry', 'Gull'],
};
const SPEED = 3.4;
const EYE = 1.55;

let uid = 0;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBot(team, name, spawn, isCarrier, rng) {
  const id = `bot-${uid++}`;
  const fig = createFighter(team);
  const actor = {
    id, name, team, isPlayer: false, isBot: true,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    // Bot yaw follows atan2(dx, dz): PI faces -Z (north), 0 faces +Z (south).
    // Each team spawns facing the sites, not its own rear wall.
    yaw: team === 'lanterns' ? Math.PI : 0, pitch: 0,
    hp: 100, armor: 0, alive: true,
    weapon: 'kr7', mag: WEAPONS.kr7.mag, reserve: WEAPONS.kr7.reserve,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    money: 800, kills: 0, deaths: 0,
    mesh: fig.group, figure: fig,
    // AI state
    ai: {
      role: 'attack',
      site: null,
      path: [],
      node: null,
      hold: null,
      target: null,
      lastSeen: null,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      blindUntil: 0,
      plantProgress: 0,
      defuseProgress: 0,
      thinkAt: rng() * 0.2,
      carrier: isCarrier,
      smokeThrown: false,
    },
  };
  fig.group.position.copy(actor.pos);
  fig.group.rotation.y = actor.yaw;
  hitMeshes(fig, actor);
  return actor;
}

export function spawnBots(scene, map, state, rng) {
  const bots = [];
  const playerTeam = state.playerTeam;
  const enemyTeam = playerTeam === 'lanterns' ? 'harbour' : 'lanterns';
  // Teammates: 4 bots on the player's team.
  for (let i = 0; i < 4; i += 1) {
    const b = createBot(playerTeam, BOT_NAMES[playerTeam][i], map.spawns[playerTeam][i + 1], false, rng);
    b.ai.role = playerTeam === 'lanterns' ? 'attack' : 'defend';
    bots.push(b);
  }
  // Enemies: 5 bots; one attacker carries the bomb when the player defends.
  for (let i = 0; i < 5; i += 1) {
    const carrier = enemyTeam === 'lanterns' && i === 0;
    const b = createBot(enemyTeam, ENEMY_NAMES[enemyTeam][i], map.spawns[enemyTeam][i], carrier, rng);
    b.ai.role = enemyTeam === 'lanterns' ? 'attack' : 'defend';
    bots.push(b);
  }
  for (const b of bots) scene.add(b.mesh);
  return bots;
}

function pickSite(rng) {
  return rng() < 0.5 ? 'A' : 'B';
}

function planRoute(bot, targetNode, map) {
  const from = nearestWaypoint(bot.pos.x, bot.pos.z);
  const ids = findPath(from, targetNode);
  bot.ai.path = ids.map((id) => map.waypoints[id]);
}

// Move toward a point with map collision; returns true when arrived.
function moveToward(bot, tx, tz, dt, map, speed = SPEED) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  bot.pos.x += (dx / d) * speed * dt;
  bot.pos.z += (dz / d) * speed * dt;
  bot.yaw = Math.atan2(dx, dz);
  resolveMove(bot.pos, 0.38, map.moveBoxes);
  return false;
}

function canSee(bot, other, map, smokeClouds, now) {
  if (!other.alive || now < bot.ai.blindUntil) return false;
  const dx = other.pos.x - bot.pos.x;
  const dz = other.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 42) return false;
  // Field of view: 100 degrees, wider when the target is close or firing.
  const ang = Math.atan2(dx, dz);
  let diff = Math.abs(ang - bot.yaw);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  const fov = other.firing ? 1.9 : 1.1;
  if (dist > 6 && diff > fov) return false;
  const ay = bot.pos.y + EYE;
  const by = other.pos.y + (other.crouched ? 1.1 : EYE);
  if (!hasLOS(bot.pos.x, ay, bot.pos.z, other.pos.x, by, other.pos.z, map.colliders)) return false;
  // Smoke blocks sight: a cloud between the two eyes hides the target.
  for (const c of smokeClouds) {
    if (c.until < now) continue;
    const mx = (bot.pos.x + other.pos.x) / 2;
    const mz = (bot.pos.z + other.pos.z) / 2;
    if ((mx - c.x) ** 2 + (mz - c.z) ** 2 < c.r * c.r) return false;
  }
  return true;
}

export function stepBots(bots, ctx, dt) {
  const { map, state, player, smokeClouds, now, rng, onBotShot, onKill, onPlantStart, onPlantDone, onDefuseDone } = ctx;
  for (const bot of bots) {
    if (!bot.alive) {
      bot.mesh.visible = false;
      continue;
    }
    bot.mesh.visible = true;
    const ai = bot.ai;
    // Periodic re-think, staggered by bot.
    if (now >= ai.thinkAt) {
      ai.thinkAt = now + 0.12 + rng() * 0.08;
      think(bot, ctx);
    }
    // Vision, hearing and acting happen only while the round is live: in the
    // buy phase the teams are still in their spawns and nobody may fight.
    // The player is a target only for bots on the other team — the scan used
    // to include the player unconditionally, so teammates shot their own
    // bomb carrier in the spawn.
    if (state.phase === 'live') {
      const enemies = [player, ...bots].filter((a) => a.team !== bot.team && a !== bot);
      let seen = null;
      let seenD = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (canSee(bot, e, map, smokeClouds, now)) {
          const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
          if (d < seenD) { seenD = d; seen = e; }
        }
      }
      if (seen) {
        if (!ai.target) ai.reactAt = now + 0.28 + rng() * 0.25;
        ai.target = seen;
        ai.lastSeen = { x: seen.pos.x, z: seen.pos.z, at: now };
      } else if (ai.target && (!ai.target.alive || now - (ai.lastSeen?.at ?? 0) > 2.5)) {
        ai.target = null;
      }
      // Hearing: recent gunfire pulls bots toward it.
      if (!ai.target && state.lastShotAt && now - state.lastShotAt.at < 1.2) {
        const d = Math.hypot(state.lastShotAt.x - bot.pos.x, state.lastShotAt.z - bot.pos.z);
        if (d < 26 && ai.role === 'defend') {
          ai.hold = { x: state.lastShotAt.x, z: state.lastShotAt.z };
        }
      }
      // Act.
      if (ai.target && now >= ai.reactAt) {
        engage(bot, ai.target, ctx, dt, now);
      } else if (ai.defuseProgress > 0 || ai.plantProgress > 0) {
        // channeling: stand still
      } else if (ai.path.length) {
        const wp = ai.path[0];
        if (moveToward(bot, wp.x, wp.z, dt, map)) ai.path.shift();
      } else if (ai.hold) {
        moveToward(bot, ai.hold.x, ai.hold.z, dt, map, SPEED * 0.6);
      }
    }
    // Objective channels.
    channelObjective(bot, ctx, dt, now);
    // Sync the visible figure.
    bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.mesh.rotation.y = bot.yaw;
    bot.mesh.visible = bot.alive;
  }
}

function think(bot, ctx) {
  const { map, state, rng } = ctx;
  const ai = bot.ai;
  if (state.phase !== 'live') return;
  if (ai.role === 'attack') {
    if (!ai.site) ai.site = pickSite(rng);
    if (state.bomb.state === 'carried') ai.hold = null; // no standing orders while the charge moves
    if (state.bomb.state === 'dropped' && state.bomb.pos) {
      // The charge is on the ground: fetch it before pushing a site. The
      // fetch preempts a route planned before the drop (the hold marks a
      // bot as already fetching; others turn around at once). A bot already
      // standing by the charge's nearest waypoint is not re-routed to that
      // waypoint — it walks the last stretch straight to the charge.
      const dBomb = Math.hypot(bot.pos.x - state.bomb.pos.x, bot.pos.z - state.bomb.pos.z);
      const fetching = ai.hold && ai.hold.x === state.bomb.pos.x && ai.hold.z === state.bomb.pos.z;
      const wpId = nearestWaypoint(state.bomb.pos.x, state.bomb.pos.z);
      const wp = map.waypoints[wpId];
      const dWp = Math.hypot(bot.pos.x - wp.x, bot.pos.z - wp.z);
      if ((!fetching || !ai.path.length) && dBomb > 2 && dWp > 1.2) planRoute(bot, wpId, map);
      ai.hold = { x: state.bomb.pos.x, z: state.bomb.pos.z };
      return;
    }
    const bombPlanted = state.bomb.state === 'planted';
    if (bombPlanted) {
      // After the plant, attackers guard the bomb.
      if (!ai.path.length && !ai.hold) {
        planRoute(bot, state.bomb.site === 'A' ? 'siteA' : 'siteB', map);
        ai.hold = { x: state.bomb.pos.x + (rng() - 0.5) * 6, z: state.bomb.pos.z + (rng() - 0.5) * 6 };
      }
      return;
    }
    if (ai.carrier && !ai.path.length && !ai.hold) {
      const siteNode = ai.site === 'A' ? 'siteA' : 'siteB';
      planRoute(bot, siteNode, map);
    } else if (!ai.carrier && !ai.path.length && !ai.hold) {
      // Non-carriers push the same site on their own lane.
      planRoute(bot, ai.site === 'A' ? 'siteA' : 'siteB', map);
    }
  } else {
    // Defenders: hold their site, or rotate to the planted bomb.
    if (state.bomb.state === 'planted') {
      if (!ai.path.length) planRoute(bot, state.bomb.site === 'A' ? 'siteA' : 'siteB', map);
      ai.hold = null;
      return;
    }
    if (!ai.hold) {
      const spots = bot.team === 'harbour'
        ? ['aHold1', 'aHold2', 'bHold1', 'bHold2', 'midHold', 'midHold2']
        : ['aHold1', 'bHold1'];
      const spot = spots[Math.floor(rng() * spots.length)];
      planRoute(bot, spot, map);
      ai.hold = map.waypoints[spot];
    }
  }
}

function engage(bot, target, ctx, dt, now) {
  const { rng, onBotShot, map } = ctx;
  const dx = target.pos.x - bot.pos.x;
  const dz = target.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  bot.yaw = Math.atan2(dx, dz);
  // Strafe a little while firing so the fight moves — through collision, so
  // a strafing bot cannot slide through crates and walls.
  const strafe = Math.sin(now * 1.7 + bot.id.charCodeAt(4)) * 0.5;
  bot.pos.x += Math.cos(bot.yaw) * strafe * dt * 1.4;
  bot.pos.z -= Math.sin(bot.yaw) * strafe * dt * 1.4;
  resolveMove(bot.pos, 0.38, map.moveBoxes);
  if (now < bot.ai.nextShotAt) return;
  if (bot.ai.burstLeft <= 0) {
    bot.ai.burstLeft = 3 + Math.floor(rng() * 3);
    bot.ai.nextShotAt = now + 0.45 + rng() * 0.4;
    return;
  }
  bot.ai.burstLeft -= 1;
  bot.ai.nextShotAt = now + 60 / 600; // carbine cadence
  // Accuracy model: nearer and slower targets are easier; crouched bots steadier.
  const speed = target.isPlayer ? 0 : 2;
  const p = Math.max(0.08, Math.min(0.62, 0.5 - dist * 0.008 - speed * 0.02 + (bot.ai.burstLeft > 2 ? 0.05 : -0.06)));
  const hit = rng() < p;
  const headshot = hit && rng() < 0.09;
  onBotShot(bot, target, hit, headshot, dist);
}

function channelObjective(bot, ctx, dt, now) {
  const { state, map, player, onPlantStart, onPlantDone, onDefuseDone } = ctx;
  const ai = bot.ai;
  if (state.phase !== 'live') return;
  // Attackers plant.
  if (ai.carrier && state.bomb.state === 'carried' && state.bomb.carrier === bot.id) {
    const siteId = ai.site;
    const s = siteId ? map.sites[siteId] : null;
    if (!s) return; // no site picked yet — the next think assigns one
    const d = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
    if (d < s.r && !ai.target) {
      if (ai.plantProgress === 0) onPlantStart(bot, siteId);
      ai.plantProgress += dt;
      if (ai.plantProgress >= 3.5) {
        ai.plantProgress = 0;
        onPlantDone(bot, siteId);
      }
    } else {
      ai.plantProgress = 0;
    }
    return;
  }
  // Defenders defuse the planted bomb.
  if (state.bomb.state === 'planted' && bot.team === 'harbour' && state.bomb.pos) {
    const d = Math.hypot(bot.pos.x - state.bomb.pos.x, bot.pos.z - state.bomb.pos.z);
    if (d < 1.8 && !ai.target) {
      ai.defuseProgress += dt;
      if (ai.defuseProgress >= 5) {
        ai.defuseProgress = 0;
        onDefuseDone(bot);
      }
    } else if (d < 8 && !ai.target) {
      moveToward(bot, state.bomb.pos.x, state.bomb.pos.z, dt, map);
    } else {
      ai.defuseProgress = 0;
    }
  }
}

export { mulberry32 };
