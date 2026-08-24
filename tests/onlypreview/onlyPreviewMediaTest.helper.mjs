/* eslint-disable @typescript-eslint/explicit-function-return-type -- test harness factories intentionally infer DOM stub shapes */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { JSDOM } from 'jsdom';

export const compileOnlyPreviewComponent = (path, id, name) => {
  const descriptor = parse(readFileSync(path, 'utf8'), { filename: path }).descriptor;
  const script = compileScript(descriptor, { id, genDefaultAs: name });
  const template = compileTemplate({
    id,
    filename: path,
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings }
  });
  assert.deepEqual(template.errors, []);
  return `${script.content}\n${template.code}\n${name}.render = render;\nexport default ${name};\nexport { createApp, defineComponent, h, nextTick, reactive } from 'vue';\n`;
};

export class FakeResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeResizeObserver.instances.push(this);
  }

  observe(element) {
    this.element = element;
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(width, height) {
    this.callback([{ contentRect: { width, height }, target: this.element }]);
  }
}

export const installMediaPreviewDom = () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://onlypreview.invalid/'
  });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    HTMLMediaElement: dom.window.HTMLMediaElement,
    HTMLAudioElement: dom.window.HTMLAudioElement,
    HTMLVideoElement: dom.window.HTMLVideoElement,
    SVGElement: dom.window.SVGElement,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    ResizeObserver: FakeResizeObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window)
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    dom,
    restore: () => {
      FakeResizeObserver.instances.length = 0;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  };
};

export const createPointerEvent = (dom, type, values = {}) => {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    button: 0,
    clientX: 0,
    clientY: 0,
    isPrimary: true,
    pointerId: 1,
    ...values
  })) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
};

export const installMediaElementMethods = (dom, operations) => {
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value() {
      operations.push([this, 'pause']);
    }
  });
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value() {
      operations.push([this, 'load']);
    }
  });
};
