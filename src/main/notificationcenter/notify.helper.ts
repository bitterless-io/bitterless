import { spawn } from 'child_process';
import { app, Notification } from 'electron';
import { join } from 'path';
import type { EyesOnAgentsCompletionAlertIntent } from '@shared/eyesOnAgents/eyesOnAgents.type';
import type { NotificationTestResult } from '@shared/setting/settingNavigation.contract';
import { i18nHelper } from '../i18n/i18n.helper';

const THREAD_COMPLETION_SOUND_FILE = 'eyes-on-agents-thread-completed.wav';
const MAX_NOTIFICATION_THREAD_TITLE_LENGTH = 300;
const NOTIFICATION_TEST_TIMEOUT_MS = 5_000;
const NOTIFICATION_RETENTION_TIMEOUT_MS = 60_000;
const WINDOWS_SOUND_COMMAND =
  '& { param([string]$SoundPath) $player = [System.Media.SoundPlayer]::new($SoundPath); ' +
  'try { $player.Load(); $player.PlaySync() } finally { $player.Dispose() } }';

const normalizeNotificationThreadTitle = (value: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return null;
  const characters = Array.from(normalized);
  if (characters.length <= MAX_NOTIFICATION_THREAD_TITLE_LENGTH) return normalized;
  return `${characters
    .slice(0, MAX_NOTIFICATION_THREAD_TITLE_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
};

const resolveThreadCompletionSoundPath = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sounds', THREAD_COMPLETION_SOUND_FILE);
  }
  return join(app.getAppPath(), 'build', 'sounds', THREAD_COMPLETION_SOUND_FILE);
};

interface NotificationRuntime {
  isSupported(): boolean;
  createNotification(options: ConstructorParameters<typeof Notification>[0]): Notification;
  scheduleTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancelTimeout(timeout: ReturnType<typeof setTimeout>): void;
  testTimeoutMs: number;
  retentionTimeoutMs: number;
}

const defaultNotificationRuntime: NotificationRuntime = {
  isSupported: () => Notification.isSupported(),
  createNotification: (options) => new Notification(options),
  scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout: (timeout) => clearTimeout(timeout),
  testTimeoutMs: NOTIFICATION_TEST_TIMEOUT_MS,
  retentionTimeoutMs: NOTIFICATION_RETENTION_TIMEOUT_MS
};

const notificationErrorDetails = (value: unknown): { errorName: string; errorMessage: string } => {
  if (value instanceof Error) {
    return { errorName: value.name, errorMessage: value.message };
  }
  return {
    errorName: typeof value,
    errorMessage: typeof value === 'string' ? value : String(value)
  };
};

export class NotifyHelper {
  private readonly runtime: NotificationRuntime;
  private readonly retainedNotifications = new Set<Notification>();

  constructor(runtime: Partial<NotificationRuntime> = {}) {
    this.runtime = { ...defaultNotificationRuntime, ...runtime };
  }

  notifyThreadCompleted(intent: EyesOnAgentsCompletionAlertIntent): void {
    this.showThreadCompletedNotification(intent);
    this.playThreadCompletionSound();
  }

  async notifyTest(): Promise<NotificationTestResult> {
    try {
      if (!this.runtime.isSupported()) {
        console.warn('[NotificationCenter] Test notification lifecycle:', {
          stage: 'unsupported'
        });
        return { ok: false, error: 'unsupported' };
      }
    } catch (err) {
      this.logLifecycleFailure('Test notification', 'support-check', err);
      return { ok: false, error: 'show-failed' };
    }

    return await new Promise<NotificationTestResult>((resolve) => {
      let notification: Notification;
      try {
        notification = this.runtime.createNotification({
          title: 'Notification test',
          body: 'Bitterless notifications are working.'
        });
      } catch (err) {
        this.logLifecycleFailure('Test notification', 'construct', err);
        resolve({ ok: false, error: 'show-failed' });
        return;
      }

      const release = this.retainNotification(notification);
      let settled = false;
      const finish = (result: NotificationTestResult): void => {
        if (settled) return;
        settled = true;
        this.runtime.cancelTimeout(lifecycleTimeout);
        notification.removeListener('show', onShow);
        notification.removeListener('failed', onFailed);
        resolve(result);
      };
      const onShow = (): void => {
        console.info('[NotificationCenter] Test notification lifecycle:', { stage: 'show' });
        finish({ ok: true });
      };
      const onFailed = (_event: unknown, error: string): void => {
        this.logLifecycleFailure('Test notification', 'failed', error);
        release();
        finish({ ok: false, error: 'show-failed' });
      };

      notification.once('show', onShow);
      notification.once('failed', onFailed);
      const lifecycleTimeout = this.runtime.scheduleTimeout(() => {
        this.logLifecycleFailure(
          'Test notification',
          'timeout',
          new Error('Native notification did not emit show or failed before the deadline.')
        );
        release();
        finish({ ok: false, error: 'show-timeout' });
      }, this.runtime.testTimeoutMs);

      try {
        notification.show();
      } catch (err) {
        this.logLifecycleFailure('Test notification', 'show-call', err);
        release();
        finish({ ok: false, error: 'show-failed' });
      }
    });
  }

  private retainNotification(notification: Notification): () => void {
    this.retainedNotifications.add(notification);
    const release = (): void => {
      if (!this.retainedNotifications.delete(notification)) return;
      this.runtime.cancelTimeout(retentionTimeout);
      notification.removeListener('close', release);
      notification.removeListener('click', release);
      notification.removeListener('action', release);
      notification.removeListener('reply', release);
      notification.removeListener('failed', release);
    };

    notification.once('close', release);
    notification.once('click', release);
    notification.once('action', release);
    notification.once('reply', release);
    notification.once('failed', release);
    const retentionTimeout = this.runtime.scheduleTimeout(release, this.runtime.retentionTimeoutMs);
    return release;
  }

  private logLifecycleFailure(scope: string, stage: string, err: unknown): void {
    console.warn(`[NotificationCenter] ${scope} lifecycle failed:`, {
      stage,
      ...notificationErrorDetails(err)
    });
  }

  private showThreadCompletedNotification(intent: EyesOnAgentsCompletionAlertIntent): void {
    try {
      if (!this.runtime.isSupported()) return;
      const messages = i18nHelper.getMessages().eyesOnAgents;
      const untitled = intent.provider === 'claude'
        ? messages.thread.untitledClaude
        : messages.thread.untitledCodex;
      const threadTitle = normalizeNotificationThreadTitle(intent.title) ?? untitled;
      const notification = this.runtime.createNotification({
        title: messages.completionNotification.title,
        body: messages.completionNotification.body.replace('{title}', () => threadTitle),
        silent: true
      });
      const release = this.retainNotification(notification);
      notification.once('failed', (_event, error) => {
        this.logLifecycleFailure('Thread completion notification', 'failed', error);
        release();
      });
      notification.show();
    } catch (err) {
      this.logLifecycleFailure('Thread completion notification', 'show-call', err);
    }
  }

  private playThreadCompletionSound(): void {
    try {
      const soundPath = resolveThreadCompletionSoundPath();
      let child;
      if (process.platform === 'darwin') {
        child = spawn('/usr/bin/afplay', [soundPath], {
          shell: false,
          stdio: 'ignore'
        });
      } else if (process.platform === 'win32') {
        child = spawn(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            WINDOWS_SOUND_COMMAND,
            soundPath
          ],
          {
            shell: false,
            stdio: 'ignore',
            windowsHide: true
          }
        );
      } else {
        return;
      }
      child.once('error', (err) => {
        console.warn('[NotificationCenter] Thread completion sound failed:', err);
      });
      child.unref();
    } catch (err) {
      console.warn('[NotificationCenter] Thread completion sound failed:', err);
    }
  }
}

export const notifyHelper = new NotifyHelper();
