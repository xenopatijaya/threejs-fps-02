// Boot and the one loop: a fixed-step 60 Hz simulation feeding a render at the
// display's rate. Rounds, the bomb, money, grenades and bot fire all live
// here; the modules do one job each and this file wires them together.
// ?shot=start|buy|combat|plant with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { createState, PHASE, BUY_SECONDS, ROUND_SECONDS, BOMB_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS, ECONOMY, awardRoundMoney, matchWinner } from './state.js';
import { createMap, hasLOS } from './map.js';
import { createPlayer, EYE_STAND } from './player.js';
import { createFighter, hitMeshes } from './characters.js';
import { spawnBots, stepBots, mulberry32 } from './bots.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, spreadFor, damageFor, applyDamage, createGrenade, stepGrenade, siteAt } from './weapons.js';
import { createEffects, createViewmodel } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene, camera);
const viewmodel = createViewmodel(camera);
const audio = createAudio();
const state = createState();
const player = createPlayer(map.moveBoxes);

const keys = new Set();
let firing = false;
let aiming = false;
let locked = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();

// The player as an actor, so bots, the HUD and the feed treat them like anyone.
const playerActor = {
  id: 'player', name: 'YOU', team: 'lanterns', isPlayer: true, isBot: false,
  pos: player.state.pos, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
  weapon: 'p9', mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
  grenades: { frag: 0, smoke: 0, flash: 0 },
  money: ECONOMY.start, kills: 0, deaths: 0, firing: false, crouched: false,
  mesh: null, figure: null,
};
let bots = [];
let actors = [playerActor];
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

let reloading = false;
let reloadEndsAt = 0;
let lastShotAt = -10;
let bloom = 0;
let plantProgress = 0;
let defuseProgress = 0;
let plantSite = null;
let buyOpen = false;
let bannerShown = false;

const hud = createHud({
  onPlay: () => { audio.unlock(); if (state.phase === PHASE.MATCH_END) restartMatch(); else if (state.phase === PHASE.MENU) startMatch('lanterns'); else inputLock(); },
  onTeam: (team) => { audio.unlock(); startMatch(team); },
  onBuy: (key) => buyItem(key),
  onScoreboard: (show) => hud.showScoreboard(show, actors, state.scores),
});

function inputLock() {
  if (shot) return;
  renderer.domElement.requestPointerLock();
}
renderer.domElement.addEventListener('click', () => {
  if ((state.phase === PHASE.BUY || state.phase === PHASE.LIVE) && !buyOpen && !locked) inputLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && (state.phase === PHASE.BUY || state.phase === PHASE.LIVE) && !buyOpen && !shot) {
    hud.showOverlay('paused');
  }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.look(e.movementX, e.movementY);
});
document.addEventListener('mousedown', (e) => {
  if (!locked || e.button === 2) return;
  if (e.button === 0) firing = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousedown', (e) => { if (e.button === 2) aiming = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 2) aiming = false; });
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyB' && state.phase === PHASE.BUY) toggleBuy();
  if (e.code === 'Digit1') selectWeapon('p9');
  if (e.code === 'Digit2') selectWeapon(playerActor.grenades ? currentPrimary() : 'p9');
  if (e.code === 'Digit3') throwGrenade('frag');
  if (e.code === 'Digit4') throwGrenade('smoke');
  if (e.code === 'Digit5') throwGrenade('flash');
  if (e.code === 'Escape' && buyOpen) toggleBuy();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

// Ammunition is kept per weapon: switching away and back restores the exact
// mag and reserve the weapon had, so a weapon switch is never a free reload.
const ammoStore = { p9: null, kr7: null, vulture: null, osprey: null };
function stashAmmo() {
  ammoStore[playerActor.weapon] = { mag: playerActor.mag, reserve: playerActor.reserve };
}
function drawAmmo(key) {
  const s = ammoStore[key];
  if (s) { playerActor.mag = s.mag; playerActor.reserve = s.reserve; }
  else { playerActor.mag = WEAPONS[key].mag; playerActor.reserve = WEAPONS[key].reserve; }
}

function currentPrimary() {
  return playerActor.ownedPrimary || 'p9';
}

function startMatch(team) {
  state.playerTeam = team;
  playerActor.team = team;
  state.scores = { lanterns: 0, harbour: 0 };
  state.round = 1;
  state.matchWinner = null;
  for (const b of bots) scene.remove(b.mesh);
  bots = spawnBots(scene, map, state, rng);
  actors = [playerActor, ...bots];
  playerActor.money = ECONOMY.start;
  playerActor.kills = 0;
  playerActor.deaths = 0;
  playerActor.survived = false;
  startRound();
}

function restartMatch() {
  state.scores = { lanterns: 0, harbour: 0 };
  state.round = 1;
  state.matchWinner = null;
  // A fresh match starts on a fresh economy and a clean scorecard, exactly
  // like startMatch — the old version kept the end-of-match money and K/D.
  playerActor.money = ECONOMY.start;
  playerActor.kills = 0;
  playerActor.deaths = 0;
  playerActor.survived = false;
  startRound();
}

function startRound() {
  state.phase = PHASE.BUY;
  state.timer = BUY_SECONDS;
  state.roundWinner = null;
  state.roundReason = '';
  plantProgress = 0;
  defuseProgress = 0;
  // Spawn everyone; survivors keep their rifle and armour, the dead start over.
  const spawns = map.spawns[state.playerTeam];
  const pSpawn = spawns[0];
  player.reset(pSpawn.x, pSpawn.z, state.playerTeam === 'lanterns' ? 0 : Math.PI);
  playerActor.pos = player.state.pos;
  playerActor.hp = 100;
  playerActor.alive = true;
  if (!playerActor.survived) {
    // The dead start over: sidearm, no armour, full fresh ammunition.
    playerActor.weapon = 'p9'; playerActor.armor = 0; playerActor.ownedPrimary = null;
    playerActor.mag = WEAPONS.p9.mag;
    playerActor.reserve = WEAPONS.p9.reserve;
    for (const k of Object.keys(ammoStore)) ammoStore[k] = null;
  }
  // Survivors keep their weapon, armour and the exact ammunition they
  // ended the round with — no free refill between rounds.
  playerActor.grenades = { frag: 0, smoke: 0, flash: 0 };
  playerActor.survived = false;
  const enemyTeam = state.playerTeam === 'lanterns' ? 'harbour' : 'lanterns';
  const seat = { lanterns: 0, harbour: 0 };
  bots.forEach((b) => {
    // Seat each team in its own spawn slots; the player's team leaves slot 0
    // for the player (the old indexing put a teammate on the player's spot).
    const idx = b.team === state.playerTeam ? seat[b.team] + 1 : seat[b.team];
    seat[b.team] += 1;
    const s = map.spawns[b.team][idx % 5];
    b.pos.set(s.x, 0, s.z);
    b.yaw = b.team === 'lanterns' ? Math.PI : 0;
    b.hp = 100;
    b.alive = true;
    b.mesh.visible = true;
    b.ai.path = [];
    b.ai.hold = null;
    b.ai.target = null;
    b.ai.site = null;
    b.ai.carrier = false;
    b.ai.plantProgress = 0;
    b.ai.defuseProgress = 0;
    b.ai.blindUntil = 0;
    // Bots buy: a rifle most rounds, sometimes the DMR or the shotgun.
    const roll = rng();
    b.weapon = roll < 0.55 ? 'kr7' : roll < 0.8 ? 'vulture' : 'osprey';
    b.mag = WEAPONS[b.weapon].mag;
    b.reserve = WEAPONS[b.weapon].reserve;
    b.armor = rng() < 0.5 ? 100 : 0;
    b.grenades = { frag: 0, smoke: 0, flash: 0 };
    b.survived = false;
  });
  // The bomb: the player carries it as a Lantern; otherwise a Lantern bot does.
  state.bomb = { state: 'carried', carrier: null, site: null, pos: null, timer: 0 };
  if (state.playerTeam === 'lanterns') {
    state.bomb.carrier = 'player';
  } else {
    const carrier = bots.find((b) => b.team === 'lanterns');
    if (carrier) { state.bomb.carrier = carrier.id; carrier.ai.carrier = true; }
  }
  hud.hideOverlay();
  hud.showBanner(`ROUND ${state.round}`, 'Buy phase — press B for weapons');
  hud.showBuy(true, playerActor.money, { armor: playerActor.armor });
  buyOpen = true;
  syncHud();
}

function endRound(winner, reason) {
  if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
  state.phase = PHASE.ROUND_END;
  state.timer = 4;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.scores[winner] += 1;
  awardRoundMoney(state, actors, winner);
  for (const a of actors) a.survived = a.alive;
  const title = winner === state.playerTeam ? 'ROUND WON' : 'ROUND LOST';
  hud.showBanner(title, reason);
  hud.showBuy(false, 0, { armor: 0 });
  buyOpen = false;
  if (winner === state.playerTeam) audio.roundWin(); else audio.roundLose();
  const mw = matchWinner(state.scores, state.round);
  if (mw) {
    state.phase = PHASE.MATCH_END;
    state.matchWinner = mw;
    state.timer = 0;
    setTimeout(() => {
      hud.showOverlay('match', {
        title: mw === 'draw' ? 'DRAW' : mw === state.playerTeam ? 'MATCH WON' : 'MATCH LOST',
        sub: `Lanterns ${state.scores.lanterns} — ${state.scores.harbour} Harbour Guard. Click to play again.`,
      });
      if (document.pointerLockElement) document.exitPointerLock();
    }, 1200);
  }
}

function buyItem(key) {
  if (state.phase !== PHASE.BUY) return;
  const m = playerActor.money;
  if (key.startsWith('g:')) {
    const g = key.slice(2);
    if (m >= GRENADES[g].price && playerActor.grenades[g] < 2) {
      playerActor.money -= GRENADES[g].price;
      playerActor.grenades[g] += 1;
      audio.click();
    }
  } else if (key === 'armor') {
    if (m >= ARMOR_PRICE && playerActor.armor < 100) {
      playerActor.money -= ARMOR_PRICE;
      playerActor.armor = 100;
      audio.click();
    }
  } else if (WEAPONS[key]) {
    if (m >= WEAPONS[key].price) {
      playerActor.money -= WEAPONS[key].price;
      stashAmmo();
      playerActor.weapon = key;
      playerActor.ownedPrimary = key;
      ammoStore[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      playerActor.mag = WEAPONS[key].mag;
      playerActor.reserve = WEAPONS[key].reserve;
      audio.click();
    }
  }
  hud.setMoney(playerActor.money);
  hud.setAmmo(playerActor.mag, playerActor.reserve, playerActor.weapon, playerActor.grenades);
  hud.showBuy(true, playerActor.money, { armor: playerActor.armor });
}

function toggleBuy() {
  buyOpen = !buyOpen;
  hud.showBuy(buyOpen, playerActor.money, { armor: playerActor.armor });
  if (!buyOpen) inputLock();
}

function selectWeapon(key) {
  if (key === 'p9' || (playerActor.ownedPrimary && key === playerActor.ownedPrimary)) {
    if (key !== playerActor.weapon) {
      stashAmmo();
      playerActor.weapon = key;
      drawAmmo(key);
    }
    syncHud();
  }
}

function startReload() {
  if (reloading || playerActor.mag === WEAPONS[playerActor.weapon].mag || playerActor.reserve <= 0) return;
  reloading = true;
  reloadEndsAt = elapsed + WEAPONS[playerActor.weapon].reload;
  audio.reload();
}

function finishReload() {
  const w = WEAPONS[playerActor.weapon];
  const need = w.mag - playerActor.mag;
  const take = Math.min(need, playerActor.reserve);
  playerActor.mag += take;
  playerActor.reserve -= take;
  reloading = false;
  syncHud();
}

function shootPlayer() {
  const w = WEAPONS[playerActor.weapon];
  const now = elapsed;
  if (now - lastShotAt < 60 / w.rpm) return;
  if (reloading) return;
  if (playerActor.mag <= 0) { audio.dry(); lastShotAt = now; return; }
  lastShotAt = now;
  playerActor.mag -= 1;
  const speed = player.groundSpeed();
  const spread = spreadFor(w, speed, player.state.crouched, bloom);
  bloom = Math.min(0.03, bloom + 0.0035);
  camera.getWorldDirection(shootDir);
  const pellets = w.pellets || 1;
  let anyHit = false;
  // The raycast target list is built once per shot, not once per pellet.
  const targets = [...map.shootables, ...bots.flatMap((b) => b.alive ? [b.figure.head, b.figure.torso, b.figure.legL, b.figure.legR] : [])];
  for (let p = 0; p < pellets; p += 1) {
    const dir = shootDir.clone();
    dir.x += (rng() * 2 - 1) * spread;
    dir.y += (rng() * 2 - 1) * spread;
    dir.z += (rng() * 2 - 1) * spread;
    dir.normalize();
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : camera.position.clone().addScaledVector(dir, 80);
    effects.tracer(camera.position.clone().addScaledVector(dir, 0.6), end);
    if (hit && hit.object.userData.actor) {
      const victim = hit.object.userData.actor;
      const raw = damageFor(w, hit.object.userData.part, hit.distance);
      const dealt = applyDamage(victim, raw);
      anyHit = true;
      hud.hitMarker(!victim.alive);
      audio.hit();
      if (!victim.alive) onKill(playerActor, victim, w);
      effects.impact(hit.point);
    } else if (hit) {
      effects.impact(hit.point);
    }
  }
  effects.muzzle();
  viewmodel.kick();
  player.recoil(w.recoil + rng() * 0.003, (rng() * 2 - 1) * 0.003);
  audio.shot(playerActor.weapon);
  state.lastShotAt = { x: player.state.pos.x, z: player.state.pos.z, at: elapsed };
  state.noises.push({ x: player.state.pos.x, z: player.state.pos.z, radius: 26, at: elapsed });
  syncHud();
}

function onKill(killer, victim, weapon) {
  victim.deaths += 1;
  killer.kills += 1;
  killer.money += ECONOMY.kill;
  const wname = weapon ? weapon.name : 'KR-7 Carbine';
  const killerLabel = killer.isPlayer ? 'YOU' : killer.name;
  const victimLabel = victim.isPlayer ? 'YOU' : victim.name;
  hud.addFeed(`${killerLabel} <span style="color:#f0a830">[${wname}]</span> ${victimLabel}`, killer.team);
  if (killer.isPlayer) audio.kill();
  if (victim.isPlayer) {
    hud.damageFlash();
    audio.hurt();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('paused');
  }
  // The bomb drops where its carrier dies.
  if (state.bomb.state === 'carried' && state.bomb.carrier === victim.id) {
    state.bomb.state = 'dropped';
    state.bomb.pos = { x: victim.pos.x, z: victim.pos.z };
    state.bomb.carrier = null;
  }
  checkRoundEnd();
}

function checkRoundEnd() {
  if (state.phase !== PHASE.LIVE) return;
  const lanAlive = actors.filter((a) => a.team === 'lanterns' && a.alive).length;
  const harAlive = actors.filter((a) => a.team === 'harbour' && a.alive).length;
  if (lanAlive === 0) endRound('harbour', 'Lanterns eliminated');
  else if (harAlive === 0) endRound('lanterns', 'Harbour Guard eliminated');
}

function throwGrenade(type) {
  if (state.phase !== PHASE.LIVE || !playerActor.alive) return;
  if (playerActor.grenades[type] <= 0) return;
  playerActor.grenades[type] -= 1;
  camera.getWorldDirection(shootDir);
  const origin = camera.position.clone().addScaledVector(shootDir, 0.5);
  origin.y -= 0.15;
  const g = createGrenade(type, origin, shootDir);
  grenades.push(g);
  audio.click();
  syncHud();
}

const grenades = [];

function detonateGrenade(g) {
  if (g.type === 'frag') {
    effects.explode(g.pos);
    audio.explosion();
    for (const a of actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - g.pos.x, a.pos.z - g.pos.z);
      if (d < 7) {
        const raw = 120 * Math.max(0, 1 - d / 7);
        applyDamage(a, raw);
        if (!a.alive) onKill(playerActor, a, { name: 'Frag' });
        else if (a.isPlayer) { hud.damageFlash(); audio.hurt(); }
      }
    }
  } else if (g.type === 'smoke') {
    effects.smoke(g.pos.x, g.pos.z, elapsed + 11);
  } else if (g.type === 'flash') {
    // Anyone looking at the burst inside 18 m is blinded for 2.5 s.
    for (const b of bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - g.pos.x, b.pos.z - g.pos.z);
      if (d < 18) {
        const dx = g.pos.x - b.pos.x;
        const dz = g.pos.z - b.pos.z;
        const ang = Math.atan2(dx, dz);
        let diff = Math.abs(ang - b.yaw);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff < 1.6) b.ai.blindUntil = elapsed + 2.5;
      }
    }
    const pd = Math.hypot(player.state.pos.x - g.pos.x, player.state.pos.z - g.pos.z);
    if (pd < 18) { hud.flashWhite(); audio.flash(); }
  }
}

function syncCamera() {
  camera.position.set(player.state.pos.x, player.state.pos.y + player.state.eye, player.state.pos.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  playerActor.yaw = player.state.yaw;
  playerActor.pitch = player.state.pitch;
  playerActor.crouched = player.state.crouched;
}

function syncHud() {
  hud.setHealth(playerActor.hp, playerActor.armor);
  hud.setMoney(playerActor.money);
  hud.setAmmo(playerActor.mag, playerActor.reserve, playerActor.weapon, playerActor.grenades);
  hud.setScore(state.scores.lanterns, state.scores.harbour, state.round, state.timer, state.phase);
  hud.setCrosshairSpread(4 + spreadFor(WEAPONS[playerActor.weapon], player.groundSpeed(), player.state.crouched, bloom) * 900);
}

function step(dt) {
  elapsed += dt;
  bloom = Math.max(0, bloom - dt * 0.02);
  if (state.phase === PHASE.BUY || state.phase === PHASE.LIVE) {
    state.timer -= dt;
  }
  if (state.phase === PHASE.BUY && state.timer <= 0) {
    state.phase = PHASE.LIVE;
    state.timer = ROUND_SECONDS;
    hud.showBuy(false, 0, { armor: 0 });
    buyOpen = false;
    hud.showBanner(`ROUND ${state.round}`, 'Go — plant the charge or hold the sites');
    inputLock();
  }
  if (state.phase === PHASE.LIVE) {
    if (state.timer <= 0) {
      if (state.bomb.state === 'planted') {
        // Timer runs on the bomb instead; the round clock stops.
      } else {
        endRound('harbour', 'Time expired — the charge was never planted');
      }
    }
    // Bomb countdown.
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      if (Math.ceil(state.bomb.timer) !== Math.ceil(state.bomb.timer + dt)) audio.beep();
      if (state.bomb.timer <= 0) {
        effects.explode(new THREE.Vector3(state.bomb.pos.x, 1, state.bomb.pos.z));
        audio.explosion();
        endRound('lanterns', 'The charge detonated');
      }
    }
    // Bomb pickup: a living Lantern walks over a dropped bomb.
    if (state.bomb.state === 'dropped' && state.bomb.pos) {
      for (const a of actors) {
        if (a.team !== 'lanterns' || !a.alive) continue;
        if (Math.hypot(a.pos.x - state.bomb.pos.x, a.pos.z - state.bomb.pos.z) < 1.3) {
          state.bomb.state = 'carried';
          state.bomb.carrier = a.id;
          if (a.isBot) a.ai.carrier = true;
          hud.addFeed(`${a.isPlayer ? 'YOU' : a.name} picked up the charge`, 'lanterns');
          break;
        }
      }
    }
    // Player plant / defuse channels (hold E).
    const wantChannel = keys.has('KeyE');
    if (wantChannel && playerActor.alive) {
      if (state.playerTeam === 'lanterns' && state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
        const site = siteAt(player.state.pos.x, player.state.pos.z, map.sites);
        if (site && player.groundSpeed() < 0.5) {
          plantProgress += dt;
          plantSite = site;
          hud.setPlantProgress(plantProgress / PLANT_SECONDS, `PLANTING AT SITE ${site}`);
          if (plantProgress >= PLANT_SECONDS) {
            state.bomb.state = 'planted';
            state.bomb.site = site;
            state.bomb.pos = { x: map.sites[site].x, z: map.sites[site].z };
            state.bomb.timer = BOMB_SECONDS;
            plantProgress = 0;
            hud.setPlantProgress(0, '');
            playerActor.money += ECONOMY.plant;
            hud.addFeed('YOU planted the charge', 'lanterns');
            audio.plantDone();
          }
        } else { plantProgress = 0; hud.setPlantProgress(0, ''); }
      } else if (state.playerTeam === 'harbour' && state.bomb.state === 'planted' && state.bomb.pos) {
        const d = Math.hypot(player.state.pos.x - state.bomb.pos.x, player.state.pos.z - state.bomb.pos.z);
        if (d < 1.8 && player.groundSpeed() < 0.5) {
          defuseProgress += dt;
          hud.setPlantProgress(defuseProgress / DEFUSE_SECONDS, 'DEFUSING THE CHARGE');
          if (defuseProgress >= DEFUSE_SECONDS) {
            defuseProgress = 0;
            hud.setPlantProgress(0, '');
            playerActor.money += ECONOMY.defuse;
            endRound('harbour', 'The charge was defused');
          }
        } else { defuseProgress = 0; hud.setPlantProgress(0, ''); }
      }
    } else {
      plantProgress = 0;
      defuseProgress = 0;
      hud.setPlantProgress(0, '');
    }
  }
  if (state.phase === PHASE.ROUND_END) {
    state.timer -= dt;
    if (state.timer <= 0 && !state.matchWinner) {
      state.round += 1;
      startRound();
    }
  }
  // Player movement and firing.
  playerActor.firing = firing;
  if ((state.phase === PHASE.BUY || state.phase === PHASE.LIVE) && playerActor.alive && !buyOpen) {
    player.step(dt, keys);
    if (firing && !reloading) {
      const w = WEAPONS[playerActor.weapon];
      if (w.auto) shootPlayer();
      else if (elapsed - lastShotAt > 0.25) shootPlayer();
    }
  }
  if (reloading && elapsed >= reloadEndsAt) finishReload();
  // Bots.
  if (state.phase === PHASE.LIVE || state.phase === PHASE.BUY) {
    stepBots(bots, {
      map, state, player: playerActor, smokeClouds: effects.smokeClouds,
      now: elapsed, rng,
      onBotShot: (bot, target, hit, headshot, dist) => {
        if (bot.mag <= 0) { bot.mag = WEAPONS[bot.weapon].mag; return; }
        bot.mag -= 1;
        const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
        const to = hit
          ? new THREE.Vector3(target.pos.x, target.pos.y + (headshot ? 1.62 : 1.2), target.pos.z)
          : new THREE.Vector3(target.pos.x + (rng() - 0.5) * 3, target.pos.y + 1 + rng() * 2, target.pos.z + (rng() - 0.5) * 3);
        effects.tracer(from, to);
        if (hit) {
          const raw = damageFor(WEAPONS[bot.weapon], headshot ? 'head' : 'body', dist);
          applyDamage(target, raw);
          if (target.isPlayer) { hud.damageFlash(); audio.hurt(); }
          if (!target.alive) onKill(bot, target, WEAPONS[bot.weapon]);
        }
        const pd = Math.hypot(bot.pos.x - player.state.pos.x, bot.pos.z - player.state.pos.z);
        if (pd < 30) audio.shot(bot.weapon);
        state.lastShotAt = { x: bot.pos.x, z: bot.pos.z, at: elapsed };
      },
      onKill,
      onPlantStart: (bot, site) => { hud.addFeed(`${bot.name} is planting at site ${site}`, 'lanterns'); },
      onPlantDone: (bot, site) => {
        state.bomb.state = 'planted';
        state.bomb.site = site;
        state.bomb.pos = { x: map.sites[site].x, z: map.sites[site].z };
        state.bomb.timer = BOMB_SECONDS;
        state.bomb.carrier = null;
        hud.addFeed(`${bot.name} planted the charge`, 'lanterns');
        audio.plantDone();
      },
      onDefuseDone: (bot) => {
        hud.addFeed(`${bot.name} defused the charge`, 'harbour');
        endRound('harbour', 'The charge was defused');
      },
    }, dt);
  }
  // Grenades.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    if (stepGrenade(grenades[i], dt, map.moveBoxes)) {
      detonateGrenade(grenades[i]);
      grenades.splice(i, 1);
    }
  }
  effects.step(dt, elapsed, camera.position);
  viewmodel.step(dt, player.groundSpeed(), aiming);
  if (aiming && playerActor.weapon === 'vulture') {
    camera.fov += (30 - camera.fov) * Math.min(1, dt * 10);
  } else {
    camera.fov += (74 - camera.fov) * Math.min(1, dt * 10);
  }
  camera.updateProjectionMatrix();
  // HUD refresh (cheap DOM writes once a frame).
  if (state.phase !== PHASE.MENU) {
    syncHud();
    hud.updateMinimap(actors, playerActor, map.sites, state.bomb, map.moveBoxes);
    if (state.phase === PHASE.BUY) hud.setBuyTimer(state.timer);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (locked || shot) {
      if (playerActor.alive && (state.phase === PHASE.BUY || state.phase === PHASE.LIVE)) {
        // look is applied from mousemove directly; nothing here
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// Deterministic captures: build a scene, step it a little, freeze it.
function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    startMatch('lanterns');
    state.phase = PHASE.MENU;
    state.timer = 0;
    player.reset(0, 12.5, 0);
    hud.showOverlay('menu');
    hud.hideBanner();
    hud.showBuy(false, 0, { armor: 0 });
    buyOpen = false;
  } else if (name === 'buy') {
    startMatch('lanterns');
    player.reset(0, 12.5, 0);
    state.scores = { lanterns: 2, harbour: 1 };
    state.round = 4;
    playerActor.money = 5400;
    hud.showBuy(true, playerActor.money, { armor: 0 });
    buyOpen = true;
  } else if (name === 'combat') {
    startMatch('lanterns');
    state.phase = PHASE.LIVE;
    state.timer = 74;
    state.scores = { lanterns: 2, harbour: 1 };
    state.round = 4;
    hud.showBuy(false, 0, { armor: 0 });
    buyOpen = false;
    player.reset(0, 6, 0);
    playerActor.weapon = 'kr7';
    playerActor.ownedPrimary = 'kr7';
    playerActor.mag = 24;
    playerActor.reserve = 90;
    playerActor.money = 450;
    playerActor.hp = 84;
    playerActor.armor = 93;
    for (let i = 0; i < 30; i += 1) step(FIXED_STEP);
    // Stage the fight after the world settles: an enemy crossing mid, a
    // teammate on the flank, a smoke cloud blooming, a tracer in the air.
    const enemy = bots.find((b) => b.team === 'harbour');
    enemy.pos.set(0.9, 0, 0);
    enemy.yaw = -0.15; // facing the player, so the shot reads as a duel
    enemy.hp = 62;
    const mate = bots.find((b) => b.team === 'lanterns');
    mate.pos.set(-5, 0, 0);
    mate.yaw = 3.0; // facing up mid, covering the push
    effects.smoke(6, -3, elapsed + 30);
    effects.tracer(new THREE.Vector3(0.3, 1.5, 5.4), new THREE.Vector3(0.9, 1.4, 0));
    hud.addFeed('Ember <span style="color:#f0a830">[KR-7 Carbine]</span> Breaker', 'lanterns');
    hud.addFeed('YOU <span style="color:#f0a830">[KR-7 Carbine]</span> Anchor', 'lanterns');
    player.state.yaw = -0.15;
    player.state.pitch = -0.01;
  } else if (name === 'plant') {
    startMatch('lanterns');
    state.phase = PHASE.LIVE;
    state.timer = 41;
    state.scores = { lanterns: 3, harbour: 3 };
    state.round = 7;
    hud.showBuy(false, 0, { armor: 0 });
    buyOpen = false;
    // The planter stands inside site A (the old staging stood 5.6 m away,
    // outside the site radius, while the HUD claimed a plant at site A).
    player.reset(-15, -5, 0.46);
    playerActor.weapon = 'kr7';
    playerActor.ownedPrimary = 'kr7';
    playerActor.mag = 18;
    playerActor.money = 2100;
    for (let i = 0; i < 20; i += 1) step(FIXED_STEP);
    const enemy = bots.find((b) => b.team === 'harbour');
    enemy.pos.set(-18, 0, -9);
    enemy.yaw = 0.64; // facing the planter
    plantProgress = PLANT_SECONDS * 0.62;
    hud.setPlantProgress(0.62, 'PLANTING AT SITE A');
    player.state.yaw = 0.46;
    player.state.pitch = -0.05;
  }
  syncHud();
  hud.updateMinimap(actors, playerActor, map.sites, state.bomb, map.moveBoxes);
  syncCamera();
  // Staged bots were moved after their last sim step: put their visible
  // figures exactly where their positions are, or the render would show them
  // where they stood before staging.
  for (const b of bots) {
    b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    b.mesh.rotation.y = b.yaw;
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Menu idle: a slow orbit over the market so the title screen is alive.
if (shot) {
  runShot(shot);
} else {
  hud.showOverlay('menu');
  syncCamera();
  requestAnimationFrame(frame);
}
