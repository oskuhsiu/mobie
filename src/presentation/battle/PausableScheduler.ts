interface PendingTask {
  callback: () => void
  remainingMs: number
  startedAt: number
  timer: ReturnType<typeof globalThis.setTimeout> | null
}

/** Timeout scheduler and logical clock whose time does not advance while paused. */
export class PausableScheduler {
  private readonly tasks = new Map<number, PendingTask>()
  private nextTaskId = 1
  private pausedAt = 0
  private pausedDurationMs = 0
  private paused = false

  constructor(private readonly readTime: () => number = () => Date.now()) {}

  get isPaused(): boolean {
    return this.paused
  }

  now(): number {
    const realNow = this.paused ? this.pausedAt : this.readTime()
    return realNow - this.pausedDurationMs
  }

  schedule(callback: () => void, delayMs: number): number {
    const id = this.nextTaskId++
    const task: PendingTask = {
      callback,
      remainingMs: Math.max(0, delayMs),
      startedAt: 0,
      timer: null,
    }
    this.tasks.set(id, task)
    if (!this.paused) this.arm(id, task)
    return id
  }

  cancel(id: number): void {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.timer !== null) globalThis.clearTimeout(task.timer)
    this.tasks.delete(id)
  }

  pause(): void {
    if (this.paused) return
    const pausedAt = this.readTime()
    this.paused = true
    this.pausedAt = pausedAt
    for (const task of this.tasks.values()) {
      if (task.timer === null) continue
      globalThis.clearTimeout(task.timer)
      task.timer = null
      task.remainingMs = Math.max(0, task.remainingMs - (pausedAt - task.startedAt))
    }
  }

  resume(): void {
    if (!this.paused) return
    const resumedAt = this.readTime()
    this.pausedDurationMs += Math.max(0, resumedAt - this.pausedAt)
    this.paused = false
    for (const [id, task] of this.tasks) this.arm(id, task)
  }

  setPaused(paused: boolean): void {
    if (paused) this.pause()
    else this.resume()
  }

  dispose(): void {
    for (const task of this.tasks.values()) {
      if (task.timer !== null) globalThis.clearTimeout(task.timer)
    }
    this.tasks.clear()
  }

  private arm(id: number, task: PendingTask): void {
    task.startedAt = this.readTime()
    task.timer = globalThis.setTimeout(() => {
      if (!this.tasks.delete(id)) return
      task.timer = null
      task.callback()
    }, task.remainingMs)
  }
}
