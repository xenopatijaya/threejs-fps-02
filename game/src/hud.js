// HUD: every DOM readout the player sees. The top bar (scores, round, timer),
// the minimap (teammates, sites, the bomb), the kill feed, health / armour /
// money, ammunition and grenades, the buy menu, the plant bar and the
// overlays for menu, round banners and the scoreboard.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { TEAMS } from './palette.js';

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    hp: $('hp-num'), armor: $('armor-num'), money: $('money-num'),
    hpBar: $('hp-bar'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-reserve'),
    weaponName: $('weapon-name'), grenades: $('grenade-counts'),
    scoreL: $('score-l'), scoreH: $('score-h'), roundLabel: $('round-label'),
    timer: $('timer'), feed: $('feed'), minimap: $('minimap'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    playBtn: $('play'), teamBtns: document.querySelectorAll('[data-team]'),
    buy: $('buy'), buyMoney: $('buy-money'), buyGrid: $('buy-grid'), buyTimer: $('buy-timer'),
    plant: $('plant'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
    scoreboard: $('scoreboard'), scoreRows: $('score-rows'),
    vignette: $('vignette'), flash: $('flash'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let bannerTimer = 0;
  let feedCount = 0;

  function teamColor(team) { return TEAMS[team].color; }

  els.playBtn.addEventListener('click', () => callbacks.onPlay());
  for (const b of els.teamBtns) {
    b.addEventListener('click', () => callbacks.onTeam(b.dataset.team));
  }
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); callbacks.onScoreboard(e.type === 'keydown'); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') callbacks.onScoreboard(false);
  });

  return {
    setHealth(hp, armor) {
      els.hp.textContent = Math.ceil(hp);
      els.armor.textContent = Math.ceil(armor);
      els.hpBar.style.width = `${Math.max(0, hp)}%`;
      els.hpBar.style.background = hp <= 30 ? '#e0483e' : '#f0a830';
    },
    setMoney(m) {
      els.money.textContent = `$${m}`;
      if (els.buyMoney) els.buyMoney.textContent = `$${m}`;
    },
    setAmmo(mag, reserve, weaponKey, grenades) {
      els.ammoMag.textContent = mag;
      els.ammoRes.textContent = `/ ${reserve}`;
      els.weaponName.textContent = WEAPONS[weaponKey].name;
      els.grenades.textContent = `[3] Frag ×${grenades.frag}  [4] Smoke ×${grenades.smoke}  [5] Flash ×${grenades.flash}`;
    },
    setScore(l, h, round, timer, phase) {
      els.scoreL.textContent = l;
      els.scoreH.textContent = h;
      els.roundLabel.textContent = `ROUND ${round} // FIRST TO 8`;
      if (phase === 'menu') { els.timer.textContent = '–:––'; return; }
      const t = Math.max(0, Math.ceil(timer));
      els.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      els.timer.style.color = phase === 'buy' ? '#f0a830' : '#e9e6df';
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(kill) {
      els.hitmarker.classList.add('on');
      if (kill) els.hitmarker.classList.add('kill');
      setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 110);
    },
    damageFlash() {
      els.vignette.classList.add('on');
      setTimeout(() => els.vignette.classList.remove('on'), 220);
    },
    flashWhite() {
      els.flash.classList.add('on');
      setTimeout(() => els.flash.classList.remove('on'), 900);
    },
    addFeed(text, team) {
      feedCount += 1;
      const div = document.createElement('div');
      div.className = 'feed-row';
      div.innerHTML = text;
      div.style.borderLeftColor = teamColor(team);
      els.feed.prepend(div);
      while (els.feed.children.length > 4) els.feed.lastChild.remove();
    },
    showBanner(title, sub) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.add('hidden'), 3200);
    },
    hideBanner() { els.banner.classList.add('hidden'); },
    showOverlay(kind, data = {}) {
      const o = els.overlay;
      o.classList.remove('hidden');
      if (kind === 'menu') {
        els.overlayTitle.textContent = 'MONSOON LANE';
        els.overlayCopy.textContent = 'A round-based tactical FPS in three.js. Five Lanterns carry the charge into a rainy night market; five Harbour Guards hold the Shrine and the Docks. Plant it, defuse it, or be the last team standing — first to 8.';
        $('team-select').classList.remove('hidden');
        $('menu-keys').classList.remove('hidden');
      } else if (kind === 'paused') {
        els.overlayTitle.textContent = 'PAUSED';
        els.overlayCopy.textContent = 'Click to play.';
        $('team-select').classList.add('hidden');
      } else if (kind === 'match') {
        els.overlayTitle.textContent = data.title;
        els.overlayCopy.textContent = data.sub;
        $('team-select').classList.add('hidden');
        $('menu-keys').classList.add('hidden');
      }
    },
    hideOverlay() { els.overlay.classList.add('hidden'); },
    setPlantProgress(frac, label) {
      if (frac <= 0) { els.plant.classList.add('hidden'); return; }
      els.plant.classList.remove('hidden');
      els.plantFill.style.width = `${Math.min(100, frac * 100)}%`;
      els.plantLabel.textContent = label;
    },
    // Buy menu: rebuilt each time it opens, so prices and affordability are fresh.
    showBuy(open, money, owned) {
      els.buy.classList.toggle('hidden', !open);
      if (!open) return;
      els.buyMoney.textContent = `$${money}`;
      els.buyGrid.innerHTML = '';
      const items = [
        ...Object.entries(WEAPONS).filter(([k]) => k !== 'p9').map(([k, w]) => ({
          key: k, name: w.name, price: w.price, desc: `${w.mag} rounds · ${w.damage} dmg`,
        })),
        { key: 'armor', name: 'Kevlar + Helmet', price: ARMOR_PRICE, desc: 'Absorbs half of damage' },
        ...Object.entries(GRENADES).map(([k, g]) => ({ key: `g:${k}`, name: g.name, price: g.price, desc: 'Throwable · press 3 / 4 / 5' })),
      ];
      for (const it of items) {
        const b = document.createElement('button');
        b.className = 'buy-item';
        b.disabled = money < it.price || (it.key === 'armor' && owned.armor >= 100);
        b.innerHTML = `<b>${it.name}</b><span>${it.desc}</span><i>$${it.price}</i>`;
        b.addEventListener('click', () => callbacks.onBuy(it.key));
        els.buyGrid.appendChild(b);
      }
    },
    setBuyTimer(t) { els.buyTimer.textContent = `BUY ${Math.max(0, Math.ceil(t))}`; },
    updateMinimap(actors, player, sites, bomb, moveBoxes) {
      const c = mapCtx;
      const S = 148;
      const W = 44;
      const H = 30;
      c.clearRect(0, 0, S, S);
      c.fillStyle = 'rgba(11,14,26,0.82)';
      c.fillRect(0, 0, S, S);
      const px = (x) => ((x + W / 2) / W) * S;
      const py = (z) => ((z + H / 2) / H) * S;
      c.fillStyle = 'rgba(152,160,168,0.5)';
      for (const b of moveBoxes) {
        if (b.h > 2) c.fillRect(px(b.x0), py(b.z0), px(b.x1) - px(b.x0), py(b.z1) - py(b.z0));
      }
      for (const [id, s] of Object.entries(sites)) {
        c.strokeStyle = id === 'A' ? '#ff5d8f' : '#35d0c5';
        c.lineWidth = 1.5;
        c.strokeRect(px(s.x - s.r), py(s.z - s.r), (s.r * 2 / W) * S, (s.r * 2 / H) * S);
        c.fillStyle = c.strokeStyle;
        c.font = 'bold 11px system-ui';
        c.fillText(id, px(s.x) - 3, py(s.z) + 4);
      }
      if (bomb.state === 'planted' && bomb.pos) {
        c.fillStyle = '#f0a830';
        c.beginPath();
        c.arc(px(bomb.pos.x), py(bomb.pos.z), 4, 0, Math.PI * 2);
        c.fill();
      }
      for (const a of actors) {
        if (!a.alive) continue;
        const isPlayer = a.isPlayer;
        c.fillStyle = isPlayer ? '#ffffff' : teamColor(a.team);
        c.beginPath();
        c.arc(px(a.pos.x), py(a.pos.z), isPlayer ? 4 : 3, 0, Math.PI * 2);
        c.fill();
        if (isPlayer) {
          c.strokeStyle = '#ffffff';
          c.beginPath();
          c.moveTo(px(a.pos.x), py(a.pos.z));
          c.lineTo(px(a.pos.x) + Math.sin(a.yaw) * -8, py(a.pos.z) + Math.cos(a.yaw) * -8);
          c.stroke();
        }
      }
    },
    showScoreboard(show, actors, scores) {
      els.scoreboard.classList.toggle('hidden', !show);
      if (!show) return;
      const rows = [...actors].sort((a, b) => b.kills - a.kills);
      els.scoreRows.innerHTML = rows.map((a) => `
        <tr class="${a.isPlayer ? 'me' : ''}">
          <td style="color:${teamColor(a.team)}">${a.name}</td>
          <td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td>
        </tr>`).join('');
      $('score-head').textContent = `LANTERNS ${scores.lanterns} — ${scores.harbour} HARBOUR GUARD`;
    },
  };
}
