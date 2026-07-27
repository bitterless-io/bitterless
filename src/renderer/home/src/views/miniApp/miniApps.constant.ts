import todoIcon from '@renderer/common/assets/icons/menu-icons/todo.png';
import omniIcon from '@renderer/common/assets/icons/omni.png';
import maestroIcon from '@renderer/common/assets/icons/maestro.png';
import coinIcon from '@renderer/common/assets/icons/coin.png';
import eyesOnAgentsIcon from '@renderer/common/assets/icons/eyes-on-agents.svg';
import type { en } from '@renderer/common/i18n/en';

export interface MiniApp {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  action: () => void | Promise<void>;
}

export const createMiniApps = (
  openTodo: () => void,
  openMaestro: () => void,
  openCoin: () => void,
  openEyesOnAgents: () => void,
  openOmniBrowser: () => void,
  i18n: typeof en,
): MiniApp[] => [
  {
    id: 'todo',
    name: i18n.miniApp.todo.name,
    subtitle: i18n.miniApp.todo.subtitle,
    icon: todoIcon,
    action: openTodo,
  },
  /*
  // Temporarily hidden: remove this block comment to restore the Maestro Mini App entry.
  {
    id: 'maestro',
    name: i18n.miniApp.maestro.name,
    subtitle: i18n.miniApp.maestro.subtitle,
    icon: maestroIcon,
    action: openMaestro,
  },
  */
  {
    id: 'coin',
    name: i18n.miniApp.coin.name,
    subtitle: i18n.miniApp.coin.subtitle,
    icon: coinIcon,
    action: openCoin,
  },
  {
    id: 'eyes-on-agents',
    name: i18n.miniApp.eyesOnAgents.name,
    subtitle: i18n.miniApp.eyesOnAgents.subtitle,
    icon: eyesOnAgentsIcon,
    action: openEyesOnAgents,
  },
  {
    id: 'omni-browser',
    name: i18n.miniApp.omniBrowser.name,
    subtitle: i18n.miniApp.omniBrowser.subtitle,
    icon: omniIcon,
    action: openOmniBrowser,
  },
];
