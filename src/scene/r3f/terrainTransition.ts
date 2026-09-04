import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { TERRAIN_WORLD_TRANSITION_MS } from './terrainVisual'

/** Shared 0→1 R3F transition clock for terrain palette, lights, materials, and fog. */
export function useTerrainTransition(
  resetKey: string,
  onStart: () => void,
  onFrame: (progress: number) => void,
) {
  const elapsed = useRef(TERRAIN_WORLD_TRANSITION_MS / 1000)
  const onStartRef = useRef(onStart)
  const onFrameRef = useRef(onFrame)
  onStartRef.current = onStart
  onFrameRef.current = onFrame

  useEffect(() => {
    onStartRef.current()
    elapsed.current = 0
  }, [resetKey])

  useFrame((_state, delta) => {
    if (elapsed.current >= TERRAIN_WORLD_TRANSITION_MS / 1000) return
    elapsed.current = Math.min(TERRAIN_WORLD_TRANSITION_MS / 1000, elapsed.current + delta)
    onFrameRef.current(elapsed.current / (TERRAIN_WORLD_TRANSITION_MS / 1000))
  })
}
