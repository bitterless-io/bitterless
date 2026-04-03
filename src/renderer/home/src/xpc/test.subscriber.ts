import { xpcRenderer } from 'electron-xpc/renderer';

xpcRenderer.subscribe('hi_everyone', (payload) => {
  console.log('[home test.subscriber] hi_everyone received:', payload);
});
