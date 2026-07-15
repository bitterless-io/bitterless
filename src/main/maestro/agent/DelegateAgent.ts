import { BaseAgent } from './BaseAgent'
import { DELEGATE_SYSTEM_PROMPT } from './prompt/delegateSysPrompt'

/**
 * Delegate — acts AS the user toward the user's CUSTOMER. Same browser/skill tools as Maestro
 * (executes recorded skills against the live page), but a customer-facing persona: the person
 * chatting is the user's customer, and the agent represents the user. Its system prompt lives in
 * prompt/delegateSysPrompt.ts. Separate session, so its conversation never mixes with Maestro/Coach.
 */
export class DelegateAgent extends BaseAgent {
  protected systemPrompt(): string {
    return DELEGATE_SYSTEM_PROMPT
  }
}
