import { spawn } from 'child_process';
import { app, Notification } from 'electron';
import { join } from 'path';
import type { EyesOnAgentsCompletionAlertIntent } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '../i18n/i18n.helper';

const THREAD_COMPLETION_SOUND_FILE = 'eyes-on-agents-thread-completed.wav';
const MAX_NOTIFICATION_THREAD_TITLE_LENGTH = 300;
const WINDOWS_SOUND_COMMAND =
  '& { param([string]$SoundPath) $player = [System.Media.SoundPlayer]::new($SoundPath); ' +
  'try { $player.Load(); $player.PlaySync() } finally { $player.Dispose() } }';

const normalizeNotificationThreadTitle = (value: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return null;
  const characters = Array.from(normalized);
  if (characters.length <= MAX_NOTIFICATION_THREAD_TITLE_LENGTH) return normalized;
  return `${characters.slice(0, MAX_NOTIFICATION_THREAD_TITLE_LENGTH - 1).join('').trimEnd()}…`;
};

const resolveThreadCompletionSoundPath = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sounds', THREAD_COMPLETION_SOUND_FILE);
  }
  return join(app.getAppPath(), 'build', 'sounds', THREAD_COMPLETION_SOUND_FILE);
};

class NotifyHelper {
  notifyThreadCompleted(intent: EyesOnAgentsCompletionAlertIntent): void {
    this.showThreadCompletedNotification(intent.title);
    this.playThreadCompletionSound();
  }

  notifyTest(): void {
    try {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: 'Notification test',
        body: 'Bitterless notifications are working.'
      });
      notification.show();
    } catch (err) {
      console.warn('[NotificationCenter] Test notification failed:', err);
    }
  }

  private showThreadCompletedNotification(rawTitle: string | null): void {
    try {
      if (!Notification.isSupported()) return;
      const messages = i18nHelper.getMessages().eyesOnAgents;
      const threadTitle = normalizeNotificationThreadTitle(rawTitle) ??
        messages.thread.untitled;
      const notification = new Notification({
        title: messages.completionNotification.title,
        body: messages.completionNotification.body.replace('{title}', () => threadTitle),
        silent: true
      });
      notification.show();
    } catch (err) {
      console.warn('[NotificationCenter] Thread completion notification failed:', err);
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
        child = spawn('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          WINDOWS_SOUND_COMMAND,
          soundPath
        ], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true
        });
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
