# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/xenopatijaya/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/xenopatijaya/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Monsoon Lane** — a round-based tactical FPS in three.js (r187). Five Lanterns
carry the charge into a rainy night market; five Harbour Guards hold the Shrine
and the Docks. Plant the bomb, defuse it, or be the last team standing —
first to 8 rounds takes the match (or the leader after 15 rounds).

You play alongside four AI teammates against five AI opponents. Every round
opens with a 12-second buy phase: spend your credits on rifles, an SMG, a
sniper, a shotgun and armour in the buy menu. The economy is exact — 800
credits to start, 3,250 for a round win, 1,900 for a loss, and 300 each for a
kill, a plant or a defuse. Rounds last 100 seconds; a planted bomb ticks for
35 seconds, takes 3.5 seconds to plant and 5 seconds to defuse.

Gunplay is deliberate: headshots pay 4×, leg shots pay less, armour absorbs
half of what is left, and recoil plus spread punish firing on the move and
reward crouching and aiming down sights. There is no jump — stopping to aim is
a decision. The map has real collision, and the HUD shows health, armour,
ammo, credits, round score and the bomb timer, plus a live minimap of
teammates, sites and the bomb so you can read the lane rotations at a glance.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in your browser. No build step, no
dependencies: `game/` is plain static files loaded as ES modules, with
three.js r187 vendored in `game/vendor/three/`.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Left click | Fire |
| Right click (hold) | Aim down sights |
| R | Reload |
| E (hold) | Plant / defuse the charge |
| B | Buy menu (during the buy phase) |
| Ctrl or C | Crouch |

## How the entry is graded

`main.ts` (Node 22, standard library only) is the entrypoint the grader
runs. It copies `game/` and `screenshots/` into `/output` and writes
`/output/dossier.json`, the summary the judge reads. Run it outside the
grader's container with `MAKEFUN_OUTPUT_DIR=out node main.ts`.

## Screenshots

Four in-game shots live in `screenshots/`: combat, the buy menu, a plant,
and the main menu.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=fmkt9ms6&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
