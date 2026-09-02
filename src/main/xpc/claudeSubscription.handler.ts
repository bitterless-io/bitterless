import { XpcMainHandler } from 'electron-xpc/main';
import type {
  ClaudeSubscriptionActionResult,
  ClaudeSubscriptionAdoptableSlot,
  ClaudeSubscriptionApi,
  ClaudeSubscriptionCopyResult,
  ClaudeSubscriptionSnapshot
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  parseClaudeSubscriptionActionResult,
  parseClaudeSubscriptionCopyResult,
  parseClaudeSubscriptionSnapshot
} from '@shared/claudeSubscription/claudeSubscription.schema';
import { claudeSubscriptionRuntime } from '@main/claudeSubscription/claudeSubscription.runtime';

const unavailableBoundaryError = (): Error =>
  new Error('Claude subscription state is unavailable.');

const parseActionBoundary = async (
  operation: Promise<ClaudeSubscriptionActionResult>
): Promise<ClaudeSubscriptionActionResult> => {
  try {
    return parseClaudeSubscriptionActionResult(await operation);
  } catch {
    throw unavailableBoundaryError();
  }
};

const readAccountId = (value: unknown): string =>
  typeof value === 'object' && value !== null && typeof (value as { accountId?: unknown }).accountId === 'string'
    ? (value as { accountId: string }).accountId
    : '';

export class ClaudeSubscriptionHandler extends XpcMainHandler implements ClaudeSubscriptionApi {
  async getSnapshot(): Promise<ClaudeSubscriptionSnapshot> {
    try {
      return parseClaudeSubscriptionSnapshot(await claudeSubscriptionRuntime.getSnapshot());
    } catch {
      throw unavailableBoundaryError();
    }
  }

  async startAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.startAuthorization(value));
  }

  async submitAuthorizationCode(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.submitAuthorizationCode(value));
  }

  async cancelAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.cancelAuthorization(value));
  }

  async renameAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.renameAccount(value));
  }

  async setAccountEnabled(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.setAccountEnabled(value));
  }

  async adoptAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.adoptAccount(value));
  }

  async listAdoptableSlots(): Promise<ClaudeSubscriptionAdoptableSlot[]> {
    try {
      return await claudeSubscriptionRuntime.listAdoptableSlots();
    } catch {
      throw unavailableBoundaryError();
    }
  }

  async setServerPort(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.setServerPort(value));
  }

  async testAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.testAccount(value));
  }

  async removeAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await parseActionBoundary(claudeSubscriptionRuntime.removeAccount(value));
  }

  async copyCodexProfile(): Promise<ClaudeSubscriptionCopyResult> {
    try {
      return parseClaudeSubscriptionCopyResult(await claudeSubscriptionRuntime.copyCodexProfile());
    } catch {
      throw unavailableBoundaryError();
    }
  }

  async captureCodexAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    const label =
      typeof value === 'object' && value !== null && typeof (value as { label?: unknown }).label === 'string'
        ? (value as { label: string }).label
        : '';
    return parseClaudeSubscriptionActionResult(
      await claudeSubscriptionRuntime.captureCodexAccount(label)
    );
  }

  async activateCodexAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return parseClaudeSubscriptionActionResult(
      await claudeSubscriptionRuntime.activateCodexAccount(readAccountId(value))
    );
  }

  async removeCodexAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return parseClaudeSubscriptionActionResult(
      await claudeSubscriptionRuntime.removeCodexAccount(readAccountId(value))
    );
  }
}

export const claudeSubscriptionHandler = new ClaudeSubscriptionHandler();
