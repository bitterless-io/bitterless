import { enCoin } from './enCoin';
import { enTrench } from './enTrench';

export const en = {
  auth: {
    navigationFailed: 'Signed in, but the page could not open. Please try again.',
    passwordSetupTitle: 'Set login password',
    passwordSetupDescription: 'Set a password before entering the workspace for the first time.',
    passwordSetupCompleteTitle: 'Password set',
    passwordSetupCompleteDescription:
      'Your password is ready. Continue to the workspace without submitting it again.',
    passwordSetupSuccess: 'Password set',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    passwordMinimum: 'At least 8 characters',
    confirmPasswordPlaceholder: 'Enter the password again',
    setPasswordAndContinue: 'Set password and continue',
    continueToWorkspace: 'Continue to workspace'
  },
  app: {
    quit: 'Quit',
    show: 'Show',
    quitConfirmTitle: 'Quit Application',
    quitConfirmMessage: 'Are you sure you want to quit?',
    quitConfirmOk: 'Quit',
    quitConfirmCancel: 'Cancel',
    keychainDeniedTitle: 'Keychain Access Required',
    keychainDeniedMessage:
      'To protect your data security, this application requires access to the system Keychain for encryption. Please allow access in the system dialog.',
    keychainDeniedOk: 'Deny',
    keychainDeniedCancel: 'Cancel',
    onlyPreviewFileMenu: {
      preview: 'Preview',
      openExternally: 'Open in system app',
      revealInFolder: 'Reveal in folder'
    }
  },
  menuBar: {
    restartToUpdate: 'update',
    updateToVersion: 'Update to {version}',
    proxy: 'Proxy',
    startupDiagnostics: {
      title: 'Startup issues',
      buttonLabel: '{count} startup issues',
      stages: {
        'core-sqlite': 'Core SQLite',
        'trench-io': 'Trench IO',
        'application-language': 'Application language',
        'window-layout': 'Window layout',
        'mcp-shim': 'Todo MCP helper',
        tray: 'System tray',
        'mcp-bridge': 'Todo MCP bridge',
        'eyes-on-agents': 'EyesOnAgents'
      }
    }
  },
  omni: {
    title: 'Omni Browser',
    layout: 'Layout',
    contentType: 'Content type',
    website: 'Website',
    miniApp: 'Mini App',
    urlInput: 'Website URL',
    urlPlaceholder: 'Enter a URL…',
    splitLeft: 'Split left',
    splitRight: 'Split right',
    splitUp: 'Split above',
    splitDown: 'Split below',
    closePane: 'Close pane',
    layoutRecoveryError: 'The saved layout could not be restored. A default browser pane is shown.',
    miniAppLoadFailed: 'Could not load {name}. Choose another app or retry this selection.'
  },
  chat: {
    inputPlaceHolder: 'Enter to send, Shift+Enter for new line',
    newSession: 'New Session',
    deleteSession: 'Delete',
    pinSession: 'Pin',
    unpinSession: 'Unpin',
    renameSession: 'Rename',
    noMessages: 'No messages yet',
    untitled: 'New Chat',
    deleteConfirmTitle: 'Delete Session',
    deleteConfirmContent:
      'Are you sure you want to delete this session? This action cannot be undone.',
    noSessions: 'No sessions',
    search: 'Search',
    searchPlaceholder: 'Search messages...',
    searchNoResults: 'No results found',
    seeMore: 'See more',
    newResponse: 'New full response',
    searchShortcutTipMac: 'Search (⌘F)',
    searchShortcutTipWin: 'Search (Alt+F)'
  },
  setting: {
    title: 'Settings',
    general: {
      tabTitle: 'General',
      language: {
        label: 'Display Language',
        zh: '简体中文',
        en: 'English'
      },
      searchEngine: {
        label: 'Search Engine',
        baidu: 'Baidu',
        duckduckgo: 'DuckDuckGo'
      },
      experimental: {
        label: 'Experimental features',
        showChatMenu: 'Show Chat in the main menu',
        showChatMenuDescription: 'Keep the existing Chat workspace available from the main menu.',
        showChatMenuSaveFailed:
          'Could not update the Chat menu setting. The previous setting was restored.'
      },
      account: {
        label: 'Account',
        logout: 'Log out'
      },
      save: 'Save',
      saveSuccess: 'Saved successfully',
      saveFailed: 'Save failed'
    },
    proxy: {
      tabTitle: 'Proxy',
      switch: 'Enable Proxy',
      ip: 'Proxy IP',
      ipPlaceholder: 'e.g. 127.0.0.1',
      port: 'Proxy Port',
      portPlaceholder: 'e.g. 7890',
      save: 'Save',
      saveSuccess: 'Saved successfully',
      saveFailed: 'Save failed',
      ipRequired: 'IP is required when proxy is enabled',
      portRequired: 'Port is required when proxy is enabled'
    },
    llm: {
      tabTitle: 'Model Config',
      activeModel: 'Active model',
      providers: 'Providers',
      provider: 'Provider',
      codex: 'Codex',
      model: 'Model',
      effort: 'Effort',
      fixed: 'Fixed',
      connected: 'Codex connected',
      loginRequired: 'Sign in to Codex to use Translator.',
      invalidated: 'Your Codex session expired. Sign in again to continue.',
      authenticating: 'Waiting for Codex sign-in…',
      unavailable: 'Codex is unavailable on this device.',
      login: 'Login',
      cancel: 'Cancel',
      reconnect: 'Reconnect',
      logout: 'Logout',
      loadFailed: 'Could not load Codex status.',
      loginFailed: 'Codex login did not complete.',
      logoutFailed: 'Could not log out of Codex.'
    },
    systemPrompt: {
      tabTitle: 'System Prompt',
      label: 'System Prompt',
      placeholder: 'Enter system prompt, Markdown supported...',
      save: 'Save',
      saveSuccess: 'Saved successfully',
      saveFailed: 'Save failed',
      hint: 'The system prompt will be sent to the AI at the beginning of each conversation to define its role and behavior.'
    },
    notification: {
      tabTitle: 'Notification',
      test: 'notification test',
      testSuccess: 'The operating system accepted the test notification.',
      testUnsupported: 'System notifications are not supported on this device.',
      testShowFailed:
        'The operating system rejected the test notification. Check the application log and notification permissions.',
      testShowTimeout:
        'The operating system did not confirm the test notification. Check notification permissions and try again.',
      testRequestFailed:
        'Could not run the notification test. Check the application log and try again.'
    },
    log: {
      tabTitle: 'Log',
      refresh: 'Refresh',
      open: 'Open',
      logFile: 'Log file',
      startup: 'Startup',
      startupReady: 'No startup issues reported.',
      directoriesTitle: 'Application directories',
      environment: 'Environment',
      configured: 'configured',
      notConfigured: 'not configured',
      valueHidden: 'value hidden',
      notCreated: 'not created',
      loadFailed: 'Could not load diagnostics. Check the application log and retry.',
      openFailed: 'Could not open this directory. Check the application log for details.',
      directoryNotCreated: 'This directory has not been created yet.',
      directories: {
        app: 'Application',
        userData: 'User data',
        sessionData: 'Session data',
        logs: 'Logs',
        cache: 'Cache',
        crashDumps: 'Crash dumps',
        temp: 'Temporary files',
        home: 'Home',
        documents: 'Documents',
        downloads: 'Downloads',
        db: 'Database',
        skills: 'Skills',
        plugins: 'Plugins',
        rigchat: 'Rigchat',
        cowork: 'Cowork',
        codexAuth: 'Codex auth',
        coin: 'Coin',
        todoistSync: 'Todoist sync',
        eyesOnAgents: 'Eyes on agents',
        mcp: 'MCP',
        bin: 'Executables',
        artifacts: 'Artifacts'
      }
    },
    about: {
      tabTitle: 'About',
      appName: 'App Name',
      version: 'Version',
      versionCode: 'Version Code',
      website: 'Website',
      openWebsite: 'Visit Website'
    }
  },
  connector: {
    wechat: {
      startLogin: 'Start Login',
      ownerVerifyTitle: 'Authenticate Owner',
      ownerVerifyHint:
        'Send the verify code to this WeChat account to set as owner. Re-authenticate after name change.',
      ownerVerified: 'Owner',
      ownerNotSet: 'Owner not set'
    },
    name: {
      wechat: 'WeChat',
      dingtalk: 'DingTalk',
      feishu: 'Feishu'
    },
    configStatus: 'Config Status',
    connectionStatus: 'Connection Status',
    editConfig: 'Edit Config',
    notConfigured: 'Not Configured',
    configured: 'Configured',
    connected: 'Connected',
    disconnected: 'Disconnected',
    notLoggedIn: 'Not Logged In',
    startLogin: 'Start Login',
    scanQrcode: 'Scan QR code with WeChat to login',
    envVariables: 'Environment Variables',
    saveOnly: 'Save Only',
    saveAndConnect: 'Save and Connect',
    disconnect: 'Disconnect',
    connecting: 'Connecting...'
  },
  pluginTest: {
    title: 'Plugin Test',
    contentUrl: 'Content URL',
    contentUrlPlaceholder: 'http://localhost:5173',
    optionUrl: 'Option URL',
    optionUrlPlaceholder: 'http://localhost:5174',
    backgroundPath: 'Background.js Path',
    backgroundPathPlaceholder: '/path/to/out/background/background.js',
    openWindow: 'Open'
  },
  miniApp: {
    open: 'Open',
    openFailed: 'Could not open {name}',
    todo: {
      name: 'Todo',
      subtitle: 'Task management and organization'
    },
    maestro: {
      name: 'Maestro',
      subtitle: 'Browser automation, agents, capture, and Workbench'
    },
    coin: {
      name: 'trench',
      subtitle: 'trenchs for trenchers'
    },
    eyesOnAgents: {
      name: 'EyesOnAgents',
      subtitle: 'Observe local Codex and Claude tasks and organize them by Domain'
    },
    submodules: {
      name: 'Submodules',
      subtitle: 'Watch the current branch of every Git submodule in one directory'
    },
    translator: {
      name: 'Translator',
      subtitle: 'Realtime Chinese and English translation with Codex'
    },
    motto: {
      name: 'Motto',
      subtitle: 'Keep important reminders close at hand'
    },
    trench: {
      name: 'Trench',
      subtitle: 'Browse local CA and wallet evidence'
    },
    onlyPreview: {
      name: 'OnlyPreview',
      subtitle: 'Fast, private previews for local files and folders'
    },
    omniBrowser: {
      name: 'Omni Browser',
      subtitle: 'Multi-pane web browser'
    }
  },
  translator: {
    title: 'Translator',
    model: 'Codex · GPT-5.5 · low',
    autoDirection: 'Auto direction',
    checking: 'Checking Codex',
    translateToEnglish: 'Translate to English',
    translateToChinese: 'Translate to Simplified Chinese',
    ready: 'Ready',
    translating: 'Translating',
    sourcePlaceholder: 'Type or paste source text…',
    emptyTitle: 'Start with a sentence',
    emptyBody: 'Chinese becomes English; English becomes Simplified Chinese.',
    loginRequired: 'Sign in to Codex to translate.',
    invalidated: 'Your Codex session expired. Sign in again to continue.',
    authenticating: 'Waiting for Codex sign-in…',
    unavailable: 'Codex is unavailable on this device.',
    login: 'Login to Codex',
    tryAgain: 'Try again',
    copyTranslation: 'Copy translation',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    characterCount: '{count} / {limit}',
    errors: {
      loadProvider: 'Could not load Codex status.',
      login: 'Codex login did not complete.',
      invalidInput: 'The source text could not be translated. Edit it and try again.',
      invalidOutput: 'Codex returned an invalid translation.',
      provider: 'Translation failed.',
      unavailable: 'Codex is not ready. Sign in and try again.',
      generic: 'Translation failed. Edit the source to try again.'
    }
  },
  motto: {
    title: 'Motto',
    add: 'Add',
    edit: 'Edit',
    delete: 'Delete',
    cardActions: 'Motto actions',
    listLabel: 'Important reminders',
    emptyTitle: 'Keep what matters in sight',
    emptyBody: 'Add a title and supporting note for something you want to remember.',
    form: {
      addTitle: 'Add motto',
      editTitle: 'Edit motto',
      title: 'Title',
      subtitle: 'Subtitle',
      titlePlaceholder: 'What matters?',
      subtitlePlaceholder: 'Add a short reminder…',
      cancel: 'Cancel',
      add: 'Add',
      save: 'Save'
    },
    errors: {
      read: 'Motto storage is unavailable. No saved reminders were changed.',
      invalid: 'Saved mottos could not be read safely. Add a motto to replace them.',
      write: 'Could not save this change. Your last saved mottos are still shown.'
    }
  },
  eyesOnAgents: {
    title: 'EyesOnAgents',
    provider: {
      codex: 'Codex',
      claude: 'Claude'
    },
    completionNotification: {
      title: 'Thread finished',
      body: '《{title}》'
    },
    connection: {
      appServer: 'App Server',
      connected: 'Connected',
      connecting: 'Connecting',
      syncing: 'Syncing',
      disconnected: 'Disconnected',
      error: 'Connection error',
      title: 'Agent connections',
      providerNavigation: 'Agent apps',
      managedTitle: 'Managed App Server',
      managedDescription:
        'Connect controls only Bitterless thread inventory and this local Codex App Server process.',
      desktopNote:
        "This never attaches to Codex Desktop's private App Server. Global Codex observation is installed and controlled separately below.",
      lastSync: 'Last sync',
      neverSynced: 'Not synced yet',
      titleEnrichment: 'Title update',
      titleEnrichmentDeferred:
        'Deferred for task {thread}: App Server unavailable. A later Refresh can retry.',
      titleEnrichmentReadRejected:
        'Could not refresh the title for task {thread}. A later Refresh can retry.',
      titleEnrichmentUnusable:
        'No usable title was returned for task {thread}. A later Refresh can retry.',
      connect: 'Connect',
      disconnect: 'Disconnect',
      retry: 'Retry'
    },
    bridge: {
      title: 'Codex observation',
      notInstalled: 'Not installed',
      needsTrust: 'Needs review',
      needsReview: 'Needs review',
      installed: 'Installed',
      observing: 'Observing',
      installedPaused: 'Installed, paused',
      disabled: 'Disabled in Codex',
      drifted: 'Needs repair',
      error: 'Status unavailable',
      statusNotInstalled: 'Not installed. Enable the Bitterless hooks to begin observation.',
      statusDrifted: 'Hook definitions changed. Repair is available.',
      statusNeedsReview: 'Needs review in Codex. Turn on and trust all four Bitterless hooks.',
      statusDisabled: 'Disabled in Codex. Turn on all four Bitterless hooks in Settings → Hooks.',
      statusModified: 'Definitions changed. Review and trust the current four-hook set in Codex.',
      statusObserving: 'All four hooks are active and the listener is receiving events.',
      statusPaused: 'The hooks are installed, but the local listener is paused.',
      statusError: 'Status unavailable.',
      installHooks: 'Install Bitterless hooks',
      codexHookSettings: 'Codex → Settings → Hooks',
      codexHookSettingsDescription:
        'Turn on and trust: SessionStart · UserPromptSubmit · PermissionRequest · Stop',
      promptRetentionLabel: 'Store latest user question',
      promptRetentionDescription: 'Off by default · one local question preview',
      removeObservation: 'Remove Codex observation',
      enable: 'Enable',
      repair: 'Repair',
      checkStatus: 'Check status',
      remove: 'Remove'
    },
    claudeBridge: {
      eyebrow: 'Claude observation',
      title: 'Local Claude observation',
      provider: 'Claude support',
      off: 'Off',
      paused: 'Claude support is paused. Codex monitoring continues unchanged.',
      pausedError: 'Claude support is paused: {error}',
      description:
        'Local metadata supplies inventory and archive state. Accurate lifecycle updates require the Bitterless Claude plugin.',
      notInstalled: 'Not installed',
      installed: 'Awaiting activity',
      observing: 'Observing',
      needsReview: 'Needs review',
      drifted: 'Needs repair',
      error: 'Status unavailable',
      plugin: 'Plugin',
      notConfigured: 'Not configured',
      enabled: 'Enabled',
      disabled: 'Disabled',
      listener: 'Listener',
      listenerActive: 'Active',
      listenerPaused: 'Listener paused',
      listeningSince: 'Listening since',
      observationProof: 'Hook status',
      proofConfirmed: 'Confirmed by event',
      proofPrevious: 'Previously received an event',
      proofNeedsReview: 'Review may be required',
      proofAwaiting: 'Awaiting first event',
      promptRetentionLabel: 'Store latest user question',
      promptRetentionDescription: 'Off by default · Hook keeps one local question preview',
      firstReceipt: 'First received event',
      lastReceipt: 'Last received event',
      lastInspected: 'Last checked',
      never: 'Never',
      enable: 'Enable Claude observation',
      enableDescription: 'Lifecycle status needs the Bitterless Claude plugin.',
      finishSetup: 'Finish setup',
      finishDescription:
        'Claude already has the enabled plugin. Bitterless can safely rebuild its local listener setup.',
      reloadInClaude: 'Reload in Claude',
      reloadDescription: 'Existing Claude sessions need one plugin reload.',
      listenerPausedDescription:
        'The plugin remains enabled. Retry Bitterless\'s local listener when you are ready.',
      retryListener: 'Retry listener',
      repair: 'Repair',
      repairDescription:
        'Reinstall and enable the Bitterless Claude plugin, then restore local observation.',
      openNewSession: 'Open new Claude session',
      copyReloadCommand: 'Copy /reload-plugins',
      copied: 'Copied',
      stillNotWorking: 'Still not working?',
      hooksDiagnostic:
        'Open the Hooks panel in Claude to inspect the Bitterless lifecycle hooks. This does not change settings.',
      hooksCommand: '/hooks',
      updatesAutomatically: 'This card updates automatically after the first event.',
      checkStatus: 'Check status',
      removePlugin: 'Remove plugin'
    },
    claudeDirectory: {
      title: 'Session directories',
      pathLabel: 'Claude config directory',
      automatic: 'Automatic',
      custom: 'Custom',
      starting: 'Starting',
      watching: 'Watching',
      waiting: 'Waiting for Claude data',
      degraded: 'Partially available',
      retrying: 'Retrying',
      error: 'Configuration error',
      stopped: 'Stopped',
      unavailable: 'Directory unavailable',
      desktopDirectories: 'Desktop metadata directories: {count}',
      lastSuccessfulScan: 'Last successful scan: {time}',
      nextRetry: 'Next retry: {time}',
      change: 'Change',
      useAutomatic: 'Use automatic',
      retry: 'Retry'
    },
    actions: {
      sync: 'Sync',
      refresh: 'Refresh',
      openConnections: 'Open connections',
      pin: 'Keep on top',
      unpin: 'Stop keeping on top',
      minimize: 'Minimize',
      maximize: 'Maximize or restore',
      close: 'Close EyesOnAgents',
      openInCodex: 'Open in Codex',
      openInClaude: 'Open in Claude',
      doubleClickHint: '(double click)',
      markRead: 'Mark as read',
      markUnread: 'Mark as unread',
      previewTranscript: 'Preview transcript',
      more: 'More actions',
      readAll: 'Read all',
      searchTitles: 'Search thread titles',
      searchTitlesMac: 'Search titles (⌘F)',
      searchTitlesWindows: 'Search titles (Ctrl+F)'
    },
    board: {
      emptyFocus: 'Nothing needs attention',
      emptyTitleSearch: 'No thread titles match this search',
      emptyTitle: 'No agent tasks yet',
      emptyBody: 'Connect Codex or refresh local Claude sessions to start monitoring.',
      loading: 'Loading observation board'
    },
    thread: {
      untitled: 'Untitled agent task',
      untitledCodex: 'Untitled Codex task',
      untitledClaude: 'Untitled Claude task',
      new: 'Unread',
      workingDirectory: 'Working directory: {path}',
      source: 'Evidence: {source}',
      appServer: 'App Server',
      codexHook: 'Desktop Bridge',
      discovery: 'Discovery',
      working: 'Working',
      waitingApproval: 'Waiting for approval',
      waitingInput: 'Waiting for input',
      idle: 'Idle',
      failed: 'Failed',
      ended: 'Ended',
      unknown: 'Unknown',
      latestQuestion: 'Latest user question: {question}',
      latestQuestionPending: 'Latest user question pending',
      latestQuestionTruncated: 'This stored preview was truncated at the 8192-byte local limit.',
      justNow: 'now',
      minutesAgo: '{count}m',
      hoursAgo: '{count}h',
      daysAgo: '{count}d'
    },
    errors: {
      load: 'The observation board could not be loaded.',
      action: 'The action could not be completed.',
      open: 'The agent app could not open this task.',
      preview: 'The Claude transcript could not be previewed.'
    }
  },
  coin: enCoin,
  trench: enTrench,
  todo: {
    title: 'Todo',
    addDomain: 'Add Domain',
    untitledDomain: 'Untitled',
    addTodo: 'Add a task...',
    addStep: 'Add step',
    today: 'Today',
    tomorrow: 'Tomorrow',
    dueDate: 'Due date',
    remind: 'Remind',
    repeat: 'Repeat',
    repeatNone: 'None',
    repeatDaily: 'Daily',
    repeatWeekly: 'Weekly',
    repeatMonthly: 'Monthly',
    repeatYearly: 'Yearly',
    repeatEvery: 'Every',
    openInWindow: 'Open in window',
    important: 'Important',
    completed: 'Completed',
    showCompleted: 'Show completed',
    hideCompleted: 'Hide completed',
    archiveDomain: 'Archive domain',
    deleteDomain: 'Delete domain',
    deleteTodo: 'Delete task',
    deleteStep: 'Delete step',
    stepPlaceholder: 'enter to save',
    domainDescriptionPlaceholder: 'Add domain description...',
    emptyDomain: 'Drop tasks here from other lists',
    todoLimitReached: 'A domain can have at most 77 incomplete tasks',
    domainLimitReached: 'You can create at most 17 domains',
    runtimeUnavailable: 'Todo is unavailable. Its local data runtime could not be opened.',
    refresh: 'Refresh',
    archive: 'Archive',
    archivedDomains: 'Archived domains',
    archivedDomainSearchPlaceholder: 'Search archived domains...',
    archivedDomainEmpty: 'No archived domains',
    archivedDomainNoMatched: 'No matching archived domains',
    archivedAt: 'Archived at',
    archivedDomainsLoadFailed: 'Failed to load archived domains',
    restoreDomain: 'Restore',
    restoreDomainSuccess: 'Domain restored',
    restoreDomainFailed: 'Failed to restore domain',
    pinOnTop: 'Always on top',
    showFocused: 'Show focused',
    hideFocused: 'Hide focused',
    focusedDomain: 'Focused',
    remindNow: 'Now',
    remindConfirm: 'Confirm',
    nextWeek: 'Next Week',
    focusedFilterImportant: 'Important',
    focusedFilterOverdue: 'Overdue',
    focusedFilterToday: 'Today',
    scrollToFocused: 'Scroll to focused',
    aiSourceTag: 'AI',
    copyTitle: 'Copy title',
    copyWithSteps: 'Copy with all steps',
    copyAll: 'Copy all',
    copyDone: 'Copied',
    copyFailed: 'Copy failed',
    copyStepsHeading: 'Steps',
    copyNoteHeading: 'Note',
    copyStepCompleted: 'Completed',
    copyStepIncomplete: 'Incomplete',
    copyNoSteps: 'No steps.',
    copyNoNote: 'No note.',
    mcpEyebrow: 'Local MCP',
    mcpTitle: 'Copy the skill to your agent',
    mcpTestInstanceTitle: 'Test-only MCP: {serverName}',
    mcpTestInstanceWarning:
      'Do not store real personal todos in this instance. Use the production bitterless server for real personal, multi-device-synchronized Todo work.',
    mcpCompleteSetup: 'Complete setup instructions',
    mcpCompleteSetupHint:
      'Copy these instructions to your agent. They include the skill and MCP setup.',
    mcpCopyCompleteSetup: 'Copy complete setup instructions',
    mcpCopied: 'Copied',
    mcpCopyFailed: 'Copy failed',
    mcpSkillVersionChecking: 'Checking bitterless-todo skill instructions',
    mcpSkillInstallRequired: 'Install bitterless-todo skill',
    mcpSkillUpdateRequired: 'Update bitterless-todo skill',
    mcpSkillVersionInvalid: 'Bitterless-todo skill instructions need attention',
    mcpSkillAcknowledgementFailed:
      'Instructions were copied, but Bitterless could not record the acknowledgement. The update dot remains.',
    mcpRestartRequiredTitle: 'Restart Bitterless',
    mcpRestartRequiredDescription:
      'This integration response came from an older main process or bundled skill revision. Restart Bitterless, then reopen this guide.',
    mcpLoadFailed: 'Failed to load MCP info',
    syncClockWrongTitle: 'System clock needs attention',
    syncClockWrongDescription:
      'Todo sync is paused because a trusted time service confirmed that this device clock differs by more than three minutes. Local changes remain safe.',
    syncClockLocal: 'Local',
    syncClockTrusted: 'Trusted',
    syncClockOffset: 'Offset',
    syncClockLastCheck: 'Last checked',
    syncClockOpenSettings: 'Open Date & Time settings',
    syncStatusTitle: 'Todo sync',
    syncStatusSyncing: 'Synchronizing…',
    syncStatusPullOnly: 'Downloading only while a clock-rejected batch is checked',
    syncStatusReady: 'Ready',
    syncStatusSucceeded: 'Synchronized',
    syncStatusFailed: 'Sync failed',
    syncCurrentResult: 'Current result',
    syncLastSuccessful: 'Last successful sync',
    syncNeverSynchronized: 'Never synchronized',
    syncErrorReason: 'Error reason',
    syncErrorDeviceIdentityMismatch:
      'The saved device identity does not match this Todo database. Sync stopped to protect local tasks.',
    syncPermanentFailures: 'Permanent failures',
    syncRetry: 'Retry',
    syncDiscard: 'Discard'
  },
  submodules: {
    title: 'Submodules',
    count: '{count} submodules',
    actions: {
      openFolder: 'Open folder',
      refresh: 'Refresh',
      openInWebStorm: 'WebStorm',
      dismiss: 'Dismiss',
      settings: 'List settings',
      search: 'Search submodules',
      searchShortcutMac: 'Search (⌘F)',
      searchShortcutWin: 'Search (Alt+F)',
      clearSearch: 'Clear search',
      minimize: 'Minimize',
      maximize: 'Maximize',
      close: 'Close'
    },
    watch: {
      live: 'Live',
      paused: 'Paused'
    },
    sort: {
      label: 'Sort',
      name: 'Name',
      updated: 'Update time'
    },
    settings: {
      title: 'List settings',
      showDiffOnTop: 'Show differ on top',
      showDiffOnTopHint: 'List submodules that differ from .gitmodules before every other row.'
    },
    branch: {
      detached: 'Detached HEAD',
      uninitialized: 'Not initialized',
      missing: 'Path missing',
      unknown: 'Unknown',
      configured: '.gitmodules pins {branch}',
      mismatch: 'differs from .gitmodules'
    },
    empty: {
      loading: 'Reading submodules…',
      title: 'No directory selected',
      body:
        'Choose a directory whose .gitmodules declares Git submodules. Bitterless remembers the ' +
        'directory and keeps every branch up to date while you work.',
      noSubmodules: 'This directory declares no submodules.',
      noMatches: 'No submodule matches this search.'
    },
    error: {
      rootMissing: 'The saved directory no longer exists.',
      rootNotADirectory: 'The saved path is not a directory.',
      gitmodulesMissing: 'This directory has no .gitmodules file.',
      gitmodulesUnreadable: 'The .gitmodules file could not be read.',
      scanFailed: 'The submodules could not be read.',
      gitdirUnreadable: 'Git directory unreadable',
      headUnreadable: 'HEAD unreadable',
      headMalformed: 'HEAD malformed',
      chooseFailed: 'The directory could not be opened.',
      openPathMissing: 'That submodule directory no longer exists.',
      ideNotFound: 'WebStorm could not be launched on this machine.',
      settingsFailed: 'The list settings could not be saved.'
    }
  },
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    saveSuccess: 'Saved successfully',
    saveFailed: 'Save failed',
    envForm: {
      edit: 'Edit',
      addVariable: 'Add Variable',
      fieldPlaceholder: 'Field name',
      valuePlaceholder: 'Value'
    }
  }
};
