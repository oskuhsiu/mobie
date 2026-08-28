export const M23_BASELINE_SCENARIO_ID = 'm23-current-parity-v1'

export const M23_GRAPHICS_OPTIONS = ['auto', 'high', 'balanced', 'compatibility'] as const
export type M23RequestedGraphics = (typeof M23_GRAPHICS_OPTIONS)[number]

export const M23_MOTION_OPTIONS = ['full', 'reduced', 'off'] as const
export type M23MotionPreference = (typeof M23_MOTION_OPTIONS)[number]

export const M23_REQUIRED_CHECKPOINTS = [
  'player-choice',
  'qte',
  'normal-attack',
  'star',
  'terrain',
  'terrain-rain',
  'switch',
  'faint',
  'outcome',
] as const

export type M23Checkpoint = (typeof M23_REQUIRED_CHECKPOINTS)[number]

export interface M23RendererResources {
  geometries: number
  textures: number
  programs: number
  triangles: number
  drawCalls: number
}

export interface M23PoolCount {
  live: number
  capacity: number | null
}
