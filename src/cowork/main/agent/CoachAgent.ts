import { BaseAgent } from './BaseAgent'
import { COACH_SYSTEM_PROMPT } from './prompt/coachSysPrompt'

/**
 * Coach — the SKILL-TRAINER agent. Creates / optimizes / deletes the recorded skills for the
 * current site via its tools; it NEVER runs a skill. The per-turn prompt (built in the window
 * helper) supplies the current site, its existing skills, and the latest recording to build from.
 * Its system prompt lives in prompt/coachSysPrompt.ts.
 */
export class CoachAgent extends BaseAgent {
  protected systemPrompt(): string {
    return COACH_SYSTEM_PROMPT
  }
}
