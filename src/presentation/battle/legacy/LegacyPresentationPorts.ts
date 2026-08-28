import type {
  BattleActionPort,
  DamageAudioPort,
  DamageHapticPort,
  DamageHudPort,
  DamageScenePort,
  LegacyEventPort,
} from '../contracts'

export interface LegacyPresentationPorts {
  scene: DamageScenePort
  hud: DamageHudPort
  audio: DamageAudioPort
  haptic: DamageHapticPort
  legacy: LegacyEventPort
  action: BattleActionPort
}
