import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(projectRoot, path), 'utf8');
const styleSource = read(
  'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less',
);
const componentSource = read(
  'src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue',
);

const dom = new JSDOM(
  '<!doctype html><html><body><div class="eyes-on-agents">'
    + '<header class="eyes-menu-bar"></header>'
    + '<main class="eyes-on-agents__main"><div class="agent-board">'
    + '<section class="agent-domain"></section></div></main>'
    + '</div></body></html>',
  { pretendToBeVisual: true, url: 'http://localhost' },
);
const browserWindow = dom.window;
for (const key of [
  'window',
  'document',
  'navigator',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Node',
  'MutationObserver',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
  'DOMParser',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window'
      ? browserWindow
      : key === 'document'
        ? browserWindow.document
        : browserWindow[key],
  });
}
globalThis.getComputedStyle = browserWindow.getComputedStyle.bind(browserWindow);
globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);

const { createApp, h, nextTick } = await import('vue');
const ArcoModule = await import('@arco-design/web-vue');
const Arco = ArcoModule.default ?? ArcoModule;

test('the connections drawer stays inside the board region and above it', async () => {
  assert.match(
    componentSource,
    /popup-container="\.eyes-on-agents__main"/,
    'the drawer must be anchored to the board region so it cannot cover the menu bar',
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(
      Arco.Drawer,
      {
        visible: true,
        class: 'eyes-connection-panel',
        placement: 'right',
        width: 540,
        footer: false,
        popupContainer: '.eyes-on-agents__main',
      },
      { default: () => h('div', 'panel') },
    ),
  });
  app.mount(host);
  await nextTick();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
  await nextTick();

  try {
    const container = document.querySelector('.arco-drawer-container');
    assert.ok(container, 'Missing rendered drawer container');
    assert.equal(
      container.parentElement?.className,
      'eyes-on-agents__main',
      'the drawer must render inside the board region, not the document body',
    );
    assert.ok(
      container.classList.contains('eyes-connection-panel'),
      'our class must land on the container so the stacking override can target it',
    );

    // Arco writes `z-index: inherit` inline for a container-anchored drawer, which drops its
    // own 1001 and leaves the panel at the board's stacking level. While that is true, the
    // stylesheet must pin the drawer above the board with an !important override.
    const inlineZIndex = container.style.zIndex;
    if (inlineZIndex === '' || inlineZIndex === 'inherit') {
      assert.match(
        styleSource,
        /\.eyes-connection-panel\.arco-drawer-container \{[^}]*z-index: \d+ !important/,
        'a drawer without its own z-index must be pinned above the board',
      );
    }
  } finally {
    app.unmount();
    host.remove();
  }
});
