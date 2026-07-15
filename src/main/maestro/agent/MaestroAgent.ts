import { BaseAgent } from './BaseAgent'
import { MAESTRO_SYSTEM_PROMPT } from './prompt/maestroSysPrompt'

/**
 * Maestro — the SKILL-EXECUTION agent. Carries out the user's request by RUNNING the recorded
 * skills for the current site against the live operation-view page. The per-turn prompt (built
 * in the window helper) supplies the current page, the time, and the catalog of skills for this site.
 * Its system prompt lives in prompt/maestroSysPrompt.ts.
 */
export class MaestroAgent extends BaseAgent {
  protected systemPrompt(): string {
    return MAESTRO_SYSTEM_PROMPT
  }
}
