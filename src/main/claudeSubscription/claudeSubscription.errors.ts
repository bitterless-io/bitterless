import { redactClaudeSubscriptionSecrets } from '@shared/claudeSubscription/claudeSubscription.redaction';

export type ClaudeSubscriptionErrorCode =
  | 'invalid_request'
  | 'subscription_required'
  | 'no_eligible_account'
  | 'claude_usage_limit'
  | 'claude_authentication'
  | 'claude_decision'
  | 'claude_execution'
  | 'claude_timeout'
  | 'request_aborted';

export abstract class ClaudeSubscriptionError extends Error {
  readonly code: ClaudeSubscriptionErrorCode;
  readonly statusCode: number;

  protected constructor(
    code: ClaudeSubscriptionErrorCode,
    statusCode: number,
    message: string,
    options?: ErrorOptions
  ) {
    super(redactClaudeSubscriptionSecrets(message), options);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ClaudeSubscriptionInvalidRequestError extends ClaudeSubscriptionError {
  constructor(message: string, options?: ErrorOptions, statusCode = 400) {
    super('invalid_request', statusCode, message, options);
  }
}

export class ClaudeNoEligibleAccountError extends ClaudeSubscriptionError {
  constructor(
    message = 'No Claude subscription account is currently eligible. Reconnect, enable, or wait for an account limit to reset.',
    options?: ErrorOptions
  ) {
    super('no_eligible_account', 429, message, options);
  }
}

export class ClaudeUsageLimitError extends ClaudeSubscriptionError {
  readonly resetAt: number | undefined;

  constructor(
    message = 'The Claude subscription account has reached its usage limit.',
    resetAt?: number
  ) {
    super('claude_usage_limit', 429, message);
    this.resetAt = resetAt;
  }
}

export class ClaudeAuthenticationError extends ClaudeSubscriptionError {
  constructor(message = 'Claude subscription authentication failed. Reconnect the account.') {
    super('claude_authentication', 401, message);
  }
}

export class ClaudeSubscriptionRequiredError extends ClaudeSubscriptionError {
  constructor(message = 'A paid Claude subscription is required for this account.') {
    super('subscription_required', 403, message);
  }
}

export class ClaudeDecisionError extends ClaudeSubscriptionError {
  constructor(message: string, options?: ErrorOptions) {
    super('claude_decision', 502, message, options);
  }
}

export class ClaudeExecutionError extends ClaudeSubscriptionError {
  constructor(message = 'Claude CLI execution failed.', options?: ErrorOptions) {
    super('claude_execution', 502, message, options);
  }
}

export class ClaudeTimeoutError extends ClaudeSubscriptionError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super('claude_timeout', 504, 'Claude CLI exceeded the request deadline.');
    this.timeoutMs = timeoutMs;
  }
}

export class ClaudeRequestAbortedError extends ClaudeSubscriptionError {
  constructor() {
    super('request_aborted', 499, 'The Claude subscription request was cancelled.');
  }
}

export const isClaudeRoutingFailure = (
  error: unknown
): error is
  | ClaudeUsageLimitError
  | ClaudeAuthenticationError
  | ClaudeSubscriptionRequiredError =>
  error instanceof ClaudeUsageLimitError ||
  error instanceof ClaudeAuthenticationError ||
  error instanceof ClaudeSubscriptionRequiredError;
