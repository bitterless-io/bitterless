import todoIcon from '@renderer/common/assets/icons/menu-icons/todo.png';
import omniIcon from '@renderer/common/assets/icons/omni.png';
import type { en } from '@renderer/common/i18n/en';

export interface MiniApp {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  action: () => void;
}

export const createMiniApps = (
  openTodo: () => void,
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
  {
    id: 'omni-browser',
    name: i18n.miniApp.omniBrowser.name,
    subtitle: i18n.miniApp.omniBrowser.subtitle,
    icon: omniIcon,
    action: openOmniBrowser,
  },
];
