import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEyesOnAgentsUuid } from '@shared/eyesOnAgents/eyesOnAgents.contract';

const execFileAsync = promisify(execFile);

// Task 094: iTerm2 exposes no working URL route for "bring this session to the front" — the
// `iterm2:///reveal?sessionid=…` link this feature shipped with is accepted by LaunchServices and
// then ignored, with either the full ITERM_SESSION_ID or its bare UUID (A/B measured, see
// docs/issues/eyes-on-agents-open-in-iterm2-does-nothing.md). AppleScript is the transport that was
// measured working: walk windows → tabs → sessions and `select` the match.

// osascript can block on the one-time macOS Automation consent dialog ("Bitterless wants to control
// iTerm2"), and an Apple Event to a wedged iTerm2 would otherwise wait out the 120s default event
// timeout. 20s is long enough for the owner to answer that dialog and short enough that one Open
// action cannot pin an XPC call open indefinitely.
const ITERM2_REVEAL_TIMEOUT_MS = 20_000;
// The script prints one short token; anything larger is a broken environment, not data to keep.
const ITERM2_REVEAL_MAX_OUTPUT_BYTES = 4_096;
const ITERM2_REVEAL_REVEALED_TOKEN = 'bitterless-iterm2-reveal:revealed';
const ITERM2_REVEAL_NOT_FOUND_TOKEN = 'bitterless-iterm2-reveal:not_found';
// -1743 / errAEEventNotPermitted: macOS refused the Apple Event outright, because Automation
// permission for iTerm2 was never granted or was revoked, or because a hardened-runtime build is
// missing com.apple.security.automation.apple-events / NSAppleEventsUsageDescription. This is a
// different, separately actionable state from "the pane is gone".
const ITERM2_REVEAL_DENIED_PATTERN = /-1743|errAEEventNotPermitted/;
const MAX_ITERM2_REVEAL_ERROR_LENGTH = 200;

export type EyesOnAgentsIterm2RevealOutcome = 'revealed' | 'not_found' | 'denied';

// The target session UUID is NEVER interpolated into this text: it arrives as `item 1 of argv`, so
// no stored value can become AppleScript source. Two further deliberate properties:
//   - `is running` is checked before any `tell`, because a bare `tell application …` LAUNCHES
//     iTerm2. Nothing may be started, raised, or activated when the target session does not exist.
//   - `ignoring case` because iTerm2 reports session ids upper-cased while the derived UUID is
//     canonicalized lower-case; AppleScript already compares text case-insensitively by default,
//     and saying so keeps that dependency explicit instead of accidental.
export const ITERM2_REVEAL_SCRIPT = [
  'on run argv',
  '  set targetId to item 1 of argv',
  '  if not (application id "com.googlecode.iterm2" is running) then',
  `    return "${ITERM2_REVEAL_NOT_FOUND_TOKEN}"`,
  '  end if',
  '  tell application id "com.googlecode.iterm2"',
  '    repeat with w in windows',
  '      repeat with t in tabs of w',
  '        repeat with s in sessions of t',
  '          ignoring case',
  '            if (id of s as text) is targetId then',
  '              select w',
  '              select t',
  '              select s',
  '              activate',
  `              return "${ITERM2_REVEAL_REVEALED_TOKEN}"`,
  '            end if',
  '          end ignoring',
  '        end repeat',
  '      end repeat',
  '    end repeat',
  '  end tell',
  `  return "${ITERM2_REVEAL_NOT_FOUND_TOKEN}"`,
  'end run'
].join('\n');

// Re-validated at the process boundary: the only value that may reach osascript is a strict UUID,
// and it is passed as its own argument, never as script text.
export const buildIterm2RevealArgs = (sessionUuid: string): string[] => {
  const uuid = parseEyesOnAgentsUuid(sessionUuid, 'iTerm2 session UUID');
  return ['-e', ITERM2_REVEAL_SCRIPT, uuid];
};

export const interpretIterm2RevealOutput = (
  stdout: string
): Exclude<EyesOnAgentsIterm2RevealOutcome, 'denied'> => {
  const token = stdout.trim();
  if (token === ITERM2_REVEAL_REVEALED_TOKEN) return 'revealed';
  if (token === ITERM2_REVEAL_NOT_FOUND_TOKEN) return 'not_found';
  throw new Error('iTerm2 returned an unrecognized reveal result');
};

const revealErrorStderr = (error: unknown): string => {
  const candidate = (error as { stderr?: unknown } | null | undefined)?.stderr;
  return typeof candidate === 'string' ? candidate : '';
};

const revealErrorKilled = (error: unknown): boolean => {
  return (error as { killed?: unknown } | null | undefined)?.killed === true;
};

// A failed `execFile` prefixes its message with the whole command — here the entire AppleScript plus
// the session UUID — so that message must never be pattern-matched or logged as-is. It is useless,
// ~1KB long, and a UUID that happens to contain `-1743` would be misread as a permission denial on
// any failure. osascript's own stderr is the only trustworthy detail; the command-echo message
// collapses to a fixed phrase.
const revealErrorDetail = (error: unknown): string => {
  const stderr = revealErrorStderr(error).trim();
  if (stderr) return stderr;
  if (revealErrorKilled(error)) return 'osascript timed out';
  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  return message.startsWith('Command failed') ? 'osascript exited without output' : message;
};

export const isIterm2AutomationDenied = (error: unknown): boolean => {
  return ITERM2_REVEAL_DENIED_PATTERN.test(revealErrorDetail(error));
};

export const summarizeIterm2RevealFailure = (error: unknown): string => {
  const detail = revealErrorDetail(error).split('\n')[0]?.trim() || 'osascript failed';
  return `iTerm2 could not be scripted: ${detail.slice(0, MAX_ITERM2_REVEAL_ERROR_LENGTH)}`;
};

export const revealIterm2Session = async (
  sessionUuid: string
): Promise<EyesOnAgentsIterm2RevealOutcome> => {
  const args = buildIterm2RevealArgs(sessionUuid);
  let stdout: string;
  try {
    const result = await execFileAsync('osascript', args, {
      timeout: ITERM2_REVEAL_TIMEOUT_MS,
      maxBuffer: ITERM2_REVEAL_MAX_OUTPUT_BYTES,
      windowsHide: true
    });
    stdout = result.stdout;
  } catch (error) {
    if (isIterm2AutomationDenied(error)) return 'denied';
    throw new Error(summarizeIterm2RevealFailure(error));
  }
  return interpretIterm2RevealOutput(stdout);
};
