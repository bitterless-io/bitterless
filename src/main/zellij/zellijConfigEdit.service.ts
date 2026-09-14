import { parse } from '@bgotink/kdl/v1-compat';
import { getLocation, type Node, type Document } from '@bgotink/kdl';
import type {
  ZellijConfigEditErrorCode,
  ZellijShortcutAction,
  ZellijShortcuts
} from './zellijConfig.type';

export type { ZellijShortcuts } from './zellijConfig.type';

export class ZellijConfigEditError extends Error {
  constructor(readonly code: ZellijConfigEditErrorCode) {
    super(code);
    this.name = 'ZellijConfigEditError';
  }
}

const ACTIONS: ZellijShortcutAction[] = ['splitDown', 'splitRight', 'closePane'];
const MODIFIERS = ['Ctrl', 'Alt', 'Super', 'Shift'];
const NAMED_KEYS = new Set([
  'Backspace',
  'Left',
  'Right',
  'Up',
  'Down',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
  'Delete',
  'Insert',
  'Esc',
  'Enter',
  'Space',
  'BackTab',
  'CapsLock',
  'ScrollLock',
  'NumLock',
  'PrintScreen',
  'Pause',
  'Menu'
]);
// Exported so the seeded default config emits the SAME bind bodies the editor later looks for —
// a seed that diverged would read back as drift the moment the settings panel opened.
export const ACTION_SOURCE: Record<ZellijShortcutAction, string> = {
  splitDown: 'NewPane "Down";',
  splitRight: 'NewPane "Right";',
  closePane: 'CloseFocus;'
};

export const defaultZellijShortcuts = (platform: string): ZellijShortcuts =>
  platform === 'darwin'
    ? { splitDown: 'Super Shift d', splitRight: 'Super d', closePane: 'Super w' }
    : { splitDown: 'Ctrl Alt d', splitRight: 'Ctrl Alt Shift d', closePane: 'Ctrl Alt w' };

export const normalizeZellijShortcut = (value: string): string => {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    Array.from(value).some((character) => character.codePointAt(0)! < 32)
  ) {
    throw new ZellijConfigEditError('shortcut-invalid');
  }
  const words = value.trim().split(/\s+/u);
  const key = words.pop() ?? '';
  const modifiers = words;
  if (
    !key ||
    modifiers.some((modifier) => !MODIFIERS.includes(modifier)) ||
    new Set(modifiers).size !== modifiers.length ||
    !(
      Array.from(key).length === 1 ||
      NAMED_KEYS.has(key) ||
      /^F(?:[1-9]|[12]\d|3[0-5])$/u.test(key)
    )
  )
    throw new ZellijConfigEditError('shortcut-invalid');
  return [...MODIFIERS.filter((modifier) => modifiers.includes(modifier)), key].join(' ');
};

const parseSource = (source: string): Document => {
  try {
    return parse(source, { storeLocations: true });
  } catch {
    throw new ZellijConfigEditError('config-invalid');
  }
};

const managedAction = (binding: Node): ZellijShortcutAction | null => {
  if (binding.getName() !== 'bind' || !binding.children || binding.children.nodes.length !== 1)
    return null;
  const action = binding.children.nodes[0];
  if (action.children || action.getProperties().size) return null;
  const args = action.getArguments();
  if (action.getName() === 'CloseFocus' && args.length === 0) return 'closePane';
  if (action.getName() !== 'NewPane' || args.length !== 1 || typeof args[0] !== 'string')
    return null;
  if (args[0].toLowerCase() === 'down') return 'splitDown';
  if (args[0].toLowerCase() === 'right') return 'splitRight';
  return null;
};

const firstKeybinds = (document: Document): Node | undefined =>
  document.nodes.find((node) => node.getName() === 'keybinds');

const keyIdentity = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    return normalizeZellijShortcut(value);
  } catch {
    return value.trim();
  }
};

export const readZellijShortcuts = (source: string, platform: string): ZellijShortcuts => {
  const defaults = defaultZellijShortcuts(platform);
  const keybinds = firstKeybinds(parseSource(source));
  const found = new Set<ZellijShortcutAction>();
  for (const mode of keybinds?.children?.nodes ?? []) {
    if (mode.getName() !== 'normal') continue;
    for (const binding of mode.children?.nodes ?? []) {
      const action = managedAction(binding);
      const key = binding.getArguments()[0];
      if (!action || found.has(action) || typeof key !== 'string') continue;
      defaults[action] = key;
      found.add(action);
    }
  }
  return defaults;
};

export const editZellijShortcuts = (source: string, input: ZellijShortcuts): string => {
  const normalized = Object.fromEntries(
    ACTIONS.map((action) => [action, normalizeZellijShortcut(input?.[action])])
  ) as unknown as ZellijShortcuts;
  const identities = ACTIONS.map((action) => normalized[action]);
  if (new Set(identities).size !== ACTIONS.length)
    throw new ZellijConfigEditError('shortcut-conflict');
  const document = parseSource(source);
  const keybinds = firstKeybinds(document);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const bindingSource = (action: ZellijShortcutAction): string =>
    `bind ${JSON.stringify(normalized[action])} { ${ACTION_SOURCE[action]} }`;
  if (!keybinds) {
    const lines = ACTIONS.map((action) => `    ${bindingSource(action)}`).join(newline);
    return `${source}${source && !source.endsWith('\n') ? newline : ''}keybinds {${newline}  normal {${newline}${lines}${newline}  }${newline}}${newline}`;
  }
  if (!keybinds.children) throw new ZellijConfigEditError('config-invalid');
  const edits: { start: number; end: number; text: string }[] = [];
  const found = new Set<ZellijShortcutAction>();
  for (const mode of keybinds.children.nodes) {
    if (
      mode.getName() === 'unbind' &&
      mode.getArguments().some((key) => identities.includes(keyIdentity(key) ?? ''))
    ) {
      throw new ZellijConfigEditError('shortcut-conflict');
    }
    if (mode.getName() !== 'normal') continue;
    const foundInMode = new Set<ZellijShortcutAction>();
    for (const binding of mode.children?.nodes ?? []) {
      const action = managedAction(binding);
      if (!action) {
        if (
          ['bind', 'unbind'].includes(binding.getName()) &&
          binding.getArguments().some((key) => identities.includes(keyIdentity(key) ?? ''))
        ) {
          throw new ZellijConfigEditError('shortcut-conflict');
        }
        continue;
      }
      const location = getLocation(binding);
      if (!location) throw new ZellijConfigEditError('config-invalid');
      edits.push({
        start: location.start.offset,
        end: location.end.offset,
        text: foundInMode.has(action) ? '' : bindingSource(action)
      });
      found.add(action);
      foundInMode.add(action);
    }
  }
  const missing = ACTIONS.filter((action) => !found.has(action));
  if (missing.length) {
    const shared = keybinds.children.nodes.find(
      (node) => node.getName() === 'normal' && node.getArguments().length === 0 && node.children
    );
    const children = shared?.children ?? keybinds.children;
    const location = getLocation(children);
    if (!location) throw new ZellijConfigEditError('config-invalid');
    const lines = missing.map((action) => `    ${bindingSource(action)}`).join(newline);
    const text = shared
      ? `${newline}${lines}${newline}  `
      : `${newline}  normal {${newline}${lines}${newline}  }${newline}`;
    edits.push({ start: location.end.offset, end: location.end.offset, text });
  }
  let next = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  parseSource(next);
  return next;
};
