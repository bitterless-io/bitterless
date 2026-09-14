import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://panel.example.test'
});
const { window } = dom;
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globalThis[key] = key === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? window[key].bind(window) : window[key];
}
window.matchMedia = () => ({ matches: true });
const { createApp, h, ref, onBeforeUnmount, nextTick } = await import('vue');
const { LinkNode } = await import('markstream-vue');
const helper = readFileSync(resolve(root, 'src/renderer/maestro/control/src/markdownLinkTooltip.service.ts'), 'utf8');
const code = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { installMarkdownLinkTooltipCleanup, dismissMarkdownLinkTooltip } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const settle = async () => { await new Promise(done => setTimeout(done, 180)); await nextTick(); };
const visible = () => [...document.querySelectorAll('[role="tooltip"]')].some(element => element.style.display !== 'none');
const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    setup() {
      const owner = ref(null);
      onBeforeUnmount(() => dismissMarkdownLinkTooltip(owner.value));
      return () => h('div', { ref: owner }, [h(LinkNode, {
        node: { type: 'link', href: 'https://example.test/reference', children: [{ type: 'text', content: '参考' }] }
      })]);
    }
  });
  app.mount(host);
  const link = host.querySelector('a');
  link.addEventListener('click', event => event.preventDefault());
  return { link, host, unmount: () => { app.unmount(); host.remove(); } };
};
const hover = link => link.dispatchEvent(new window.MouseEvent('mouseenter', { clientX: 10, clientY: 10 }));
after(() => dom.window.close());

test('real Markdown URL tooltip dismisses on activation, blur and scroll, including pending hover work', async () => {
  const dispose = installMarkdownLinkTooltipCleanup();
  const item = mount();
  try {
    for (const event of ['pointerdown', 'click', 'auxclick', 'blur', 'scroll']) {
      for (const pending of [false, true]) {
        hover(item.link);
        if (!pending) {
          await settle();
          assert.equal(visible(), true, 'normal hover must keep showing the original tooltip');
          assert.equal(document.querySelector('[role="tooltip"]').textContent, 'https://example.test/reference');
        }
        const target = event === 'blur' ? window : event === 'scroll' ? item.host : item.link;
        target.dispatchEvent(new window.MouseEvent(event, { bubbles: true, cancelable: true, button: event === 'auxclick' ? 1 : 0 }));
        await settle();
        assert.equal(visible(), false, `${event} must dismiss ${pending ? 'pending' : 'visible'} tooltip`);
      }
    }
  } finally {
    item.unmount();
    dispose();
  }
});

test('message unmount only dismisses its own tooltip and leaves the singleton usable', async () => {
  const dispose = installMarkdownLinkTooltipCleanup();
  let item = mount();
  try {
    hover(item.link);
    await settle();
    const unrelated = mount();
    unrelated.unmount();
    await settle();
    assert.equal(visible(), true, 'another message leaving the list must not dismiss this hovered link');
    item.unmount();
    await settle();
    assert.equal(visible(), false, 'the owner leaving the list must dismiss its tooltip');
    item = mount();
    hover(item.link);
    item.unmount();
    await settle();
    assert.equal(visible(), false, 'unmount cancels a hover that has not reached its show timer');
    item = mount();
    hover(item.link);
    await settle();
    assert.equal(visible(), true, 'new links still use the existing singleton after cleanup');
    dispose();
    await settle();
    assert.equal(visible(), false, 'Control teardown dismisses the active tooltip');
  } finally {
    item.unmount();
    dispose();
  }
});
