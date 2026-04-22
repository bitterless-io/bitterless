// Injected into every omni browser cell (raw web content).
// Layer 1: Override window.Notification to suppress system popups from main thread.
window.Notification = class InterceptedNotification {
  static permission: NotificationPermission = 'granted';

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve('granted' as NotificationPermission);
  }

  constructor(title: string, options?: NotificationOptions) {
    console.log('[OmniCellContent] window.Notification intercepted:', {
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

// Layer 2: Intercept Service Worker showNotification to suppress SW-triggered notifications.
function patchServiceWorkerRegistration(registration: ServiceWorkerRegistration): void {
  const orig = registration.showNotification.bind(registration);
  registration.showNotification = (title: string, options?: NotificationOptions): Promise<void> => {
    console.log('[OmniCellContent] SW showNotification intercepted:', {
      title,
      body: options?.body,
      icon: options?.icon,
      tag: options?.tag,
      silent: options?.silent,
      time: new Date().toISOString(),
    });
    return Promise.resolve();
  };
  // Keep orig reference available for future controlled restoration
  (registration as any).__origShowNotification = orig;
}

// Patch any already-active SW registration
if (navigator.serviceWorker) {
  navigator.serviceWorker.ready
    .then((registration) => {
      patchServiceWorkerRegistration(registration);
    })
    .catch(() => {});

  // Patch SW registrations created after page load
  const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
  navigator.serviceWorker.register = async (
    scriptURL: string | URL,
    options?: RegistrationOptions,
  ): Promise<ServiceWorkerRegistration> => {
    const registration = await origRegister(scriptURL, options);
    patchServiceWorkerRegistration(registration);
    return registration;
  };
}
