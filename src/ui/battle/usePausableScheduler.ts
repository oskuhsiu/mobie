import { useEffect, useRef } from 'react'
import { PausableScheduler } from '@/presentation/battle/PausableScheduler'

/** Keeps rAF logical time and component timeouts aligned across document pauses. */
export function usePausableScheduler(paused: boolean): PausableScheduler {
  const schedulerRef = useRef<PausableScheduler | null>(null)
  if (schedulerRef.current === null) {
    schedulerRef.current = new PausableScheduler(() => performance.now())
  }
  const scheduler = schedulerRef.current

  useEffect(() => {
    scheduler.setPaused(paused)
  }, [paused, scheduler])

  useEffect(() => () => scheduler.dispose(), [scheduler])

  return scheduler
}
