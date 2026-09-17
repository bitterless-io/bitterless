import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** No error messages, call logs, stdout, attachments or HTML: a fill failure can contain secrets. */
export default class RedactedAuthReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult): void {
    console.log(`[auth-e2e] login/logout: ${result.status}`);
    if (result.status !== 'passed') {
      const stage = result.errors
        .map((error) => error.message?.match(/\[auth-e2e-stage:([a-z-]+)\]/)?.[1])
        .find(Boolean);
      console.log(`[auth-e2e] failed stage: ${stage || 'preflight-or-timeout'}`);
    }
  }
  onEnd(result: FullResult): void {
    console.log(`[auth-e2e] result: ${result.status}`);
  }
}
