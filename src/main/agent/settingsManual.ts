import { SETTINGS_TABS } from '@maestro-shared/settingsNavigation'

/** Bundled Bitterless manual. Cowork maintains its own customer-facing instructions. */
export const SETTINGS_MANUAL_SECTIONS = [
  {
    topic: 'overview',
    title: 'Bitterless / Maestro',
    content: 'Bitterless brings Maestro browser-and-agent work together with personal apps. Start a Chat in Maestro, choose a model, describe the task, and attach or select the workspace and browser tab relevant to it. The Chat workspace determines which local project files and skills are available. Read the agent\'s results and answer decision cards when it needs your input. Stop a running turn from the Chat controls when you need to change direction. Opening Settings does not execute a recorded skill or change customer data.'
  },
  {
    topic: 'settings',
    title: 'Settings navigation',
    content: 'Use the Settings button in Maestro to open the settings tab. General is the first section, immediately before Capture. Settings remembers the last selected section. Ask /menu to list the sections, /menu models to open Models, or “打开设置里的技能页” to open Skills. Opening a section displays it for you without changing its values. /manual returns this built-in help; /manual capture narrows the help to Capture.'
  },
  ...SETTINGS_TABS.map(({ tab, label, description }) => ({ topic: tab, title: label, content: description + ' ' + ({
    general: 'Choose a category in General, inspect its current values, then change only the preference you intend to update. Terminal settings links also open General.',
    capture: 'Start and stop recording with the browser capture controls. Inspect the recorded action/request rows here, adjust network recording filters when necessary, and export the captured evidence. A captured trace is evidence; it is not proof that a reusable skill has been validated.',
    skills: 'Inspect a skill\'s source, scope and instructions before using it. Skills bound to a Chat workspace depend on that workspace. After editing skill files outside Bitterless, use /reload-skills; the refreshed catalog takes effect from the next message. Built-in menu and manual work without recorded recipes.',
    workflows: 'Inspect available workflows and their runs. A workflow run can continue as a background task; check its status and output before treating the work as complete.',
    injections: 'Inspect the target website domain and the configured skill before creating or removing a floating skill button. Showing this page alone does not inject a button.',
    tools: 'Read a tool\'s use case and safety boundary before adjusting its policy. Changing an approval policy affects later tool calls; merely opening Tools changes nothing.',
    models: 'Inspect provider availability and authentication state. Configure the provider you intend to use and select a supported model for the Chat. Never paste credentials into shared project files.',
    apps: 'Choose the app for the task: Todo for personal actions, OnlyPreview for local file viewing, Eyes on Agents for agent activity, Omni Browser for browsing, or Zellij for terminal work. Use the Open action on the app you want; menu apps only displays this launcher.',
    connectors: 'Inspect the integrations shown by this build. An integration listed here is not a guarantee that an account is connected or that every action is available.',
    about: 'Use the displayed version and application identity when reporting an issue. Opening About does not install an update.',
    log: 'Use the displayed log location and diagnostic details when investigating a failure. Check relevant timestamps and avoid sharing secrets from logs.'
  } as Record<string, string>)[tab] }))
]
