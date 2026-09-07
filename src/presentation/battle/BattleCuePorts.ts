import type {
  BattleActionPort,
  DamageAudioPort,
  DamageHapticPort,
  DamageHudPort,
  DamageScenePort,
  EventScenePort,
} from './contracts'

export interface BattleCuePorts {
  scene: DamageScenePort
  hud: DamageHudPort
  audio: DamageAudioPort
  haptic: DamageHapticPort
  event: EventScenePort
  action: BattleActionPort
}
