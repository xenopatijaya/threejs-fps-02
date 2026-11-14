// The one state store: match, rounds, economy and the bomb. Rendering, input
// and bot AI read this object and never keep their own copy of it, so a round
// can be reset by rebuilding one object instead of chasing scattered flags.
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const WIN_TARGET = 8;
export const MAX_ROUNDS = 15;
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const PLANT_SECONDS = 3.5;
export const DEFUSE_SECONDS = 5.0;

export const ECONOMY = {
  start: 800,
  win: 3250,
  loss: 1900,
  kill: 300,
  plant: 300,
  defuse: 300,
};

export function createState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    timer: 0,
    scores: { lanterns: 0, harbour: 0 },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    playerTeam: 'lanterns',
    // Bomb: carried (by player or a bot id), planted (with site + timer), or gone.
    bomb: { state: 'carried', carrier: 'player', site: null, pos: null, timer: 0 },
    feed: [],
    // Noise events bots can hear: { x, z, radius, kind, at }.
    noises: [],
    // How many attackers have been seen planting / where the last shots came from.
    lastShotAt: null,
    roundStartAt: 0,
  };
}

// Award money to one side's living fighters at round end.
export function awardRoundMoney(state, actors, winnerTeam) {
  for (const a of actors) {
    if (!a.alive) continue;
    a.money += a.team === winnerTeam ? ECONOMY.win : ECONOMY.loss;
  }
}

// First to WIN_TARGET, or the leader when MAX_ROUNDS is reached.
export function matchWinner(scores, round) {
  if (scores.lanterns >= WIN_TARGET) return 'lanterns';
  if (scores.harbour >= WIN_TARGET) return 'harbour';
  if (round > MAX_ROUNDS) {
    if (scores.lanterns === scores.harbour) return 'draw';
    return scores.lanterns > scores.harbour ? 'lanterns' : 'harbour';
  }
  return null;
}
