// Injected into every omni browser cell (raw web content).
// Overrides window.Notification to suppress all system popups and log intercepted notifications.
window.Notification = class InterceptedNotification {
  static permission: NotificationPermission = 'granted';

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve('granted' as NotificationPermission);
  }

  constructor(title: string, options?: NotificationOptions) {
    console.log('[OmniCellContent] Notification intercepted:', {
      title,
      body: options?.body,
      icon: options?.icon,
      tag: options?.tag,
      silent: options?.silent,
      time: new Date().toISOString(),
    });
  }

  addEventListener(_type: string, _listener: EventListenerOrEventListenerObject): void {}
  removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject): void {}
  dispatchEvent(_event: Event): boolean { return false; }
  close(): void {}
  onclick: ((this: Notification, ev: Event) => any) | null = null;
  onclose: ((this: Notification, ev: Event) => any) | null = null;
  onerror: ((this: Notification, ev: Event) => any) | null = null;
  onshow: ((this: Notification, ev: Event) => any) | null = null;
} as any;
