// Palette: one rainy night-market lane. Deep indigo night, warm sodium lamps,
// teal awnings, red lanterns, amber accents. Every colour in the game and the
// HUD comes from these twelve names, so the scene reads as one place.
export const PALETTE = {
  canvas: '#0b0e1a', // night sky and fog
  ground: '#232733', // wet cobblestones
  groundWet: '#2e3444', // puddle strips, slightly glossier
  plaster: '#3a3f4d', // walls
  plasterDark: '#2a2e3a', // shadowed walls
  wood: '#6b4a2f', // stalls and carts
  woodDark: '#4a3220', // stall frames
  awningTeal: '#1f7a6d', // market awnings, Harbour Guard
  awningRed: '#a83226', // lanterns and awnings, Lanterns
  lantern: '#f0a830', // lamps, signage, accent
  neonPink: '#ff5d8f', // one neon sign
  neonCyan: '#35d0c5', // one neon sign
  ink: '#e9e6df', // HUD text
  muted: '#98a0a8', // HUD secondary text
  container: '#7a4a2e', // rusted containers
  containerBlue: '#2e5a6e', // painted containers
};

// Team identity: Lanterns attack with the charge, Harbour Guard defends.
export const TEAMS = {
  lanterns: { name: 'Lanterns', short: 'LAN', color: '#f0a830', dark: '#a83226' },
  harbour: { name: 'Harbour Guard', short: 'HRB', color: '#35d0c5', dark: '#1f7a6d' },
};
