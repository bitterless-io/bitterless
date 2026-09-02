/** Mechanical policy for messages sent while an assistant turn is already active. */
export type StreamingBehavior = 'steer' | 'followUp'

export type SteeringMode = 'all' | 'one-at-a-time'

export interface SteeringSignals {
  streaming: boolean
  compacting: boolean
  pendingSteeringCount: number
  steeringMode: SteeringMode
  aborting: boolean
}

export interface SteeringDecision {
  behavior: StreamingBehavior
  rule: 0 | 1 | 2 | 3 | 4
  reason: string
}

/**
 * Prefer steering an active turn. Queue the message only when the current turn is compacting,
 * already has a queued steering message under one-at-a-time mode, or is being aborted.
 */
export const decideStreamingBehavior = (signals: SteeringSignals): SteeringDecision => {
  const decide = (
    behavior: StreamingBehavior,
    rule: SteeringDecision['rule'],
    reason: string
  ): SteeringDecision => ({ behavior, rule, reason })

  if (signals.aborting) return decide('followUp', 4, 'turn is aborting')
  if (signals.steeringMode === 'one-at-a-time' && signals.pendingSteeringCount > 0) {
    return decide('followUp', 3, `steering pending (${signals.pendingSteeringCount}) under one-at-a-time`)
  }
  if (signals.compacting) return decide('followUp', 2, 'compaction in progress — queue until it finishes')
  if (signals.streaming) return decide('steer', 1, 'streaming')
  return decide('steer', 0, 'not streaming — sent anyway to close the isStreaming race')
}
