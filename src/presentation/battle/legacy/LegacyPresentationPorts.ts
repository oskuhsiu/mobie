import type {
  LegacyEventPort,
  NormalAttackAudioPort,
  NormalAttackHapticPort,
  NormalAttackHudPort,
  NormalAttackScenePort,
} from '../contracts'

export interface LegacyPresentationPorts {
  scene: NormalAttackScenePort
  hud: NormalAttackHudPort
  audio: NormalAttackAudioPort
  haptic: NormalAttackHapticPort
  legacy: LegacyEventPort
}
