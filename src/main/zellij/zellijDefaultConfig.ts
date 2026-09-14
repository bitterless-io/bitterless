import { ACTION_SOURCE, defaultZellijShortcuts } from './zellijConfigEdit.service';
import {
  ZELLIJ_BINDS_PLACEHOLDER,
  ZELLIJ_DEFAULT_CONFIG_TEMPLATE
} from './zellijDefaultConfig.constant';
import type { ZellijShortcutAction } from './zellijConfig.type';

/**
 * Composes the defaults ensured in `<userData>/zellij/config.kdl` on open.
 *
 * The KDL itself lives in `zellijDefaultConfig.constant.ts`; this file only injects the keybinds,
 * which cannot be literal text there — they have to come from the SAME defaults the settings panel
 * shows and the SAME bind bodies the editor looks for, or the seed reads back as drift on first
 * open.
 */
const ACTIONS: ZellijShortcutAction[] = ['splitDown', 'splitRight', 'closePane'];

export const buildZellijDefaultConfig = ({ platform }: { platform: string }): string => {
  const shortcuts = defaultZellijShortcuts(platform);
  const binds = ACTIONS.map(
    (action) => `    bind ${JSON.stringify(shortcuts[action])} { ${ACTION_SOURCE[action]} }`
  ).join('\n');
  return ZELLIJ_DEFAULT_CONFIG_TEMPLATE.replace(ZELLIJ_BINDS_PLACEHOLDER, binds);
};
