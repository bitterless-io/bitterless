/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import {
  compileOnlyPreviewComponent,
  createPointerEvent,
  FakeResizeObserver,
  installMediaElementMethods,
  installMediaPreviewDom
} from './onlyPreviewMediaTest.helper.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-media-'));
const imagePreviewPath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/components/ImagePreview/ImagePreview.vue'
);
const mediaPreviewPath = join(
  projectRoot,
  'src/renderer/onlypreview/preview/src/components/MediaPreview/MediaPreview.vue'
);

const imagePreviewCompiled = compileOnlyPreviewComponent(
  imagePreviewPath,
  'onlypreview-image-test',
  '__imagePreview'
);
const mediaPreviewCompiled = compileOnlyPreviewComponent(
  mediaPreviewPath,
  'onlypreview-media-test',
  '__mediaPreview'
);

await build({
  entryPoints: {
    imageSession: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewImage.service.ts'
    ),
    mediaSession: join(
      projectRoot,
      'src/renderer/onlypreview/preview/src/onlyPreviewMedia.service.ts'
    ),
    imagePreview: imagePreviewPath,
    mediaPreview: mediaPreviewPath
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'compile-onlypreview-media-components',
      setup(buildContext) {
        buildContext.onLoad({ filter: /ImagePreview\.vue$/ }, (args) => {
          if (args.path !== imagePreviewPath) return null;
          return { contents: imagePreviewCompiled, loader: 'ts', resolveDir: dirname(args.path) };
        });
        buildContext.onLoad({ filter: /MediaPreview\.vue$/ }, (args) => {
          if (args.path !== mediaPreviewPath) return null;
          return { contents: mediaPreviewCompiled, loader: 'ts', resolveDir: dirname(args.path) };
        });
        buildContext.onResolve({ filter: /onlyPreviewPreview\.store$/ }, () => ({
          path: 'preview-store',
          namespace: 'onlypreview-media-test'
        }));
        buildContext.onResolve({ filter: /onlyPreviewI18n$/ }, () => ({
          path: 'preview-i18n',
          namespace: 'onlypreview-media-test'
        }));
        buildContext.onResolve({ filter: /^@tabler\/icons-vue$/ }, () => ({
          path: 'preview-icons',
          namespace: 'onlypreview-media-test'
        }));
        buildContext.onLoad({ filter: /.*/, namespace: 'onlypreview-media-test' }, ({ path }) => {
          if (path === 'preview-store') {
            return {
              loader: 'js',
              resolveDir: projectRoot,
              contents: `
                const harness = () => globalThis.__onlyPreviewMediaComponentHarness;
                export const onlyPreviewPreviewStore = {
                  reportSurfaceReady: (...args) => harness().ready.push(args),
                  reportSurfaceError: (...args) => harness().errors.push(args)
                };
              `
            };
          }
          if (path === 'preview-i18n') {
            return {
              loader: 'js',
              resolveDir: projectRoot,
              contents: `
                export const onlyPreviewI18n = {
                  preview: {
                    imageViewport: 'Image preview viewport',
                    imageFit: 'Fit image',
                    imageRotateLeft: 'Rotate left',
                    imageRotateRight: 'Rotate right',
                    imageZoomOut: 'Zoom out',
                    imageZoomIn: 'Zoom in',
                    imageReset: 'Reset image',
                    audioPlayer: 'Audio player for {name}',
                    videoPlayer: 'Video player for {name}'
                  }
                };
              `
            };
          }
          return {
            loader: 'js',
            resolveDir: projectRoot,
            contents: `
              import { h } from 'vue';
              const icon = { render: () => h('svg', { 'aria-hidden': 'true' }) };
              export const IconAspectRatio = icon;
              export const IconMusic = icon;
              export const IconRotate = icon;
              export const IconRotateClockwise = icon;
              export const IconZoomIn = icon;
              export const IconZoomOut = icon;
              export const IconZoomReset = icon;
            `
          };
        });
      }
    }
  ]
});

const imageSession = await import(pathToFileURL(join(buildRoot, 'imageSession.mjs')).href);
const mediaSession = await import(pathToFileURL(join(buildRoot, 'mediaSession.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const tick = () => new Promise((resolveTick) => setImmediate(resolveTick));

const assertCode = (code) => (error) => {
  assert.equal(error?.code, code);
  return true;
};

const imageResponse = (bytes, overrides = {}) =>
  new Response(bytes, {
    status: overrides.status ?? 200,
    headers: {
      'Content-Length': String(overrides.contentLength ?? bytes.byteLength),
      'Content-Type': 'image/png'
    }
  });

const mediaResponse = (size, overrides = {}) =>
  new Response(null, {
    status: overrides.status ?? 200,
    headers: {
      'Content-Length': String(overrides.contentLength ?? size),
      ...(overrides.acceptRanges === false ? {} : { 'Accept-Ranges': 'bytes' })
    }
  });

test('image session verifies the complete body, decodes off-DOM, and revokes each URL once', async () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const revoked = [];
  const createdBlobs = [];
  const fetchCalls = [];
  const removedSources = [];
  const session = new imageSession.OnlyPreviewImageSession({
    fetchImpl: async (url, init) => {
      fetchCalls.push({ init, url });
      return imageResponse(bytes);
    },
    createImage: () => ({
      decoding: 'auto',
      src: '',
      naturalWidth: 640,
      naturalHeight: 480,
      decode: async () => undefined,
      removeAttribute: (name) => removedSources.push(name)
    }),
    createObjectUrl: (blob) => {
      createdBlobs.push(blob);
      return 'blob:onlypreview-image-1';
    },
    revokeObjectUrl: (url) => revoked.push(url)
  });

  const render = await session.load(
    'bitterless-preview://asset/image.png',
    bytes.length,
    'image/png'
  );
  assert.deepEqual(render, {
    objectUrl: 'blob:onlypreview-image-1',
    naturalWidth: 640,
    naturalHeight: 480
  });
  assert.equal(fetchCalls[0].init.signal.aborted, false);
  assert.equal(createdBlobs[0].size, bytes.length);
  assert.equal(createdBlobs[0].type, 'image/png');
  assert.deepEqual(removedSources, ['src']);
  assert.deepEqual(revoked, []);
  session.dispose();
  session.dispose();
  assert.deepEqual(revoked, ['blob:onlypreview-image-1']);
});

test('image session separates empty/read/decode failures and cleans decoder-construction errors', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  let fetchCount = 0;
  const empty = new imageSession.OnlyPreviewImageSession({
    fetchImpl: async () => {
      fetchCount += 1;
      return imageResponse(bytes);
    }
  });
  await assert.rejects(empty.load('asset', 0, 'image/png'), assertCode('IMAGE_EMPTY'));
  assert.equal(fetchCount, 0);

  for (const fetchImpl of [
    async () => imageResponse(bytes, { status: 404 }),
    async () => imageResponse(bytes, { contentLength: bytes.length + 1 }),
    async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(bytes.length) }),
      blob: async () => {
        throw new Error('body failed');
      }
    }),
    async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(bytes.length) }),
      blob: async () => new Blob([])
    })
  ]) {
    const session = new imageSession.OnlyPreviewImageSession({ fetchImpl });
    await assert.rejects(
      session.load('asset', bytes.length, 'image/png'),
      assertCode('IMAGE_READ_FAILED')
    );
    session.dispose();
  }

  for (const createImage of [
    () => {
      throw new Error('constructor failed');
    },
    () => {
      const image = {
        decoding: 'auto',
        naturalWidth: 1,
        naturalHeight: 1,
        decode: async () => undefined,
        removeAttribute: () => undefined
      };
      Object.defineProperty(image, 'src', {
        set: () => {
          throw new Error('source assignment failed');
        }
      });
      return image;
    },
    () => ({
      decoding: 'auto',
      src: '',
      naturalWidth: 1,
      naturalHeight: 1,
      decode: async () => {
        throw new Error('decode failed');
      },
      removeAttribute: () => undefined
    }),
    () => ({
      decoding: 'auto',
      src: '',
      naturalWidth: 0,
      naturalHeight: 0,
      decode: async () => undefined,
      removeAttribute: () => undefined
    })
  ]) {
    const revoked = [];
    const session = new imageSession.OnlyPreviewImageSession({
      fetchImpl: async () => imageResponse(bytes),
      createImage,
      createObjectUrl: () => 'blob:failed-image',
      revokeObjectUrl: (url) => revoked.push(url)
    });
    await assert.rejects(
      session.load('asset', bytes.length, 'image/png'),
      assertCode('IMAGE_DECODE_FAILED')
    );
    session.dispose();
    assert.deepEqual(revoked, ['blob:failed-image']);
  }
});

test('image session aborts a stale revision and never revokes the replacement URL', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const decodes = [deferred(), deferred()];
  const revoked = [];
  let imageIndex = 0;
  let urlIndex = 0;
  const session = new imageSession.OnlyPreviewImageSession({
    fetchImpl: async () => imageResponse(bytes),
    createImage: () => {
      const decode = decodes[imageIndex++];
      return {
        decoding: 'auto',
        src: '',
        naturalWidth: 10,
        naturalHeight: 10,
        decode: () => decode.promise,
        removeAttribute: () => undefined
      };
    },
    createObjectUrl: () => `blob:image-${++urlIndex}`,
    revokeObjectUrl: (url) => revoked.push(url)
  });

  const stale = session.load('asset-1', bytes.length, 'image/png');
  await tick();
  const current = session.load('asset-2', bytes.length, 'image/png');
  await tick();
  assert.deepEqual(revoked, ['blob:image-1']);
  decodes[0].resolve();
  await assert.rejects(stale, assertCode('IMAGE_READ_FAILED'));
  decodes[1].resolve();
  assert.equal((await current).objectUrl, 'blob:image-2');
  session.dispose();
  assert.deepEqual(revoked, ['blob:image-1', 'blob:image-2']);
});

test('media HEAD preflight requires exact readable range metadata and maps native errors', async () => {
  const calls = [];
  const session = new mediaSession.OnlyPreviewMediaSession({
    fetchImpl: async (url, init) => {
      calls.push({ init, url });
      return mediaResponse(12);
    }
  });
  await session.prepare('bitterless-preview://asset/audio.mp3', 12);
  assert.equal(calls[0].init.method, 'HEAD');
  assert.equal(calls[0].init.signal.aborted, false);
  session.dispose();
  assert.equal(calls[0].init.signal.aborted, true);

  let emptyFetches = 0;
  const empty = new mediaSession.OnlyPreviewMediaSession({
    fetchImpl: async () => {
      emptyFetches += 1;
      return mediaResponse(0);
    }
  });
  await assert.rejects(empty.prepare('asset', 0), assertCode('MEDIA_EMPTY'));
  assert.equal(emptyFetches, 0);

  for (const response of [
    mediaResponse(12, { status: 404 }),
    mediaResponse(12, { contentLength: 11 }),
    mediaResponse(12, { acceptRanges: false })
  ]) {
    const failed = new mediaSession.OnlyPreviewMediaSession({ fetchImpl: async () => response });
    await assert.rejects(failed.prepare('asset', 12), assertCode('MEDIA_READ_FAILED'));
    failed.dispose();
  }
  const rejected = new mediaSession.OnlyPreviewMediaSession({
    fetchImpl: async () => {
      throw new Error('missing capability');
    }
  });
  await assert.rejects(rejected.prepare('asset', 12), assertCode('MEDIA_READ_FAILED'));

  assert.deepEqual([1, 2, 3, 4, 0, null].map(mediaSession.mapOnlyPreviewMediaErrorCode), [
    'MEDIA_ABORTED',
    'MEDIA_NETWORK_FAILED',
    'MEDIA_DECODE_FAILED',
    'MEDIA_SOURCE_UNSUPPORTED',
    'MEDIA_READ_FAILED',
    'MEDIA_READ_FAILED'
  ]);
});

test('ImagePreview mounts only decoded content and enforces accessible fit, zoom, pan, and stale fences', async () => {
  const environment = installMediaPreviewDom();
  try {
    globalThis.__onlyPreviewMediaComponentHarness = { ready: [], errors: [] };
    const runtime = await import(
      `${pathToFileURL(join(buildRoot, 'imagePreview.mjs')).href}?case=image-component`
    );
    const root = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(root);
    const app = runtime.createApp(runtime.default, {
      content: {
        objectUrl: 'https://onlypreview.invalid/image.png',
        naturalWidth: 1_000,
        naturalHeight: 500
      },
      alt: 'Fixture image',
      reportingRevision: '41'
    });
    app.mount(root);
    await runtime.nextTick();

    const viewport = root.querySelector('[name="onlypreview__imagePreview"]');
    const image = root.querySelector('[name="onlypreview__imageContent"]');
    assert.ok(viewport);
    assert.ok(image);
    assert.equal(image.getAttribute('draggable'), 'false');
    assert.equal(image.getAttribute('alt'), 'Fixture image');
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, []);

    FakeResizeObserver.instances.at(-1).emit(400, 300);
    await runtime.nextTick();
    assert.equal(image.style.transform, 'rotate(0deg) scale(0.4)');
    const controls = [...root.querySelectorAll('.onlypreview-image__control')];
    assert.equal(controls.length, 6);
    assert.deepEqual(
      controls.map((button) => [button.getAttribute('aria-label'), button.getAttribute('title')]),
      [
        ['Fit image', 'Fit image'],
        ['Rotate left', 'Rotate left'],
        ['Rotate right', 'Rotate right'],
        ['Zoom out', 'Zoom out'],
        ['Zoom in', 'Zoom in'],
        ['Reset image', 'Reset image']
      ]
    );
    assert.equal(controls[0].disabled, true);
    controls[2].click();
    await runtime.nextTick();
    assert.equal(image.style.transform, 'rotate(90deg) scale(0.3)');
    controls[1].click();
    await runtime.nextTick();
    assert.equal(image.style.transform, 'rotate(0deg) scale(0.4)');
    controls[4].click();
    await runtime.nextTick();
    assert.equal(image.style.transform, 'rotate(0deg) scale(0.5)');
    controls[5].click();
    await runtime.nextTick();
    assert.equal(image.style.transform, 'rotate(0deg) scale(1)');

    const captured = new Set();
    viewport.setPointerCapture = (pointerId) => captured.add(pointerId);
    viewport.hasPointerCapture = (pointerId) => captured.has(pointerId);
    viewport.releasePointerCapture = (pointerId) => captured.delete(pointerId);
    controls[4].dispatchEvent(createPointerEvent(environment.dom, 'pointerdown'));
    assert.equal(captured.size, 0, 'toolbar pointerdown must not start a canvas drag');
    viewport.dispatchEvent(
      createPointerEvent(environment.dom, 'pointerdown', { clientX: 10, clientY: 10 })
    );
    assert.equal(captured.has(1), true);
    viewport.dispatchEvent(
      createPointerEvent(environment.dom, 'pointermove', { clientX: 999, clientY: 999 })
    );
    await runtime.nextTick();
    const origin = root.querySelector('.onlypreview-image__origin');
    assert.match(origin.style.transform, /translate\(300px, 100px\)/);
    viewport.dispatchEvent(createPointerEvent(environment.dom, 'pointercancel'));
    assert.equal(captured.size, 0);
    viewport.dispatchEvent(createPointerEvent(environment.dom, 'pointerdown'));
    assert.equal(captured.has(1), true);
    captured.delete(1);
    viewport.dispatchEvent(createPointerEvent(environment.dom, 'lostpointercapture'));
    await runtime.nextTick();
    assert.equal(viewport.classList.contains('onlypreview-image--dragging'), false);

    const beforeButtonArrow = origin.style.transform;
    controls[4].dispatchEvent(
      new environment.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })
    );
    assert.equal(origin.style.transform, beforeButtonArrow);
    viewport.dispatchEvent(
      new environment.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })
    );
    await runtime.nextTick();
    assert.notEqual(origin.style.transform, beforeButtonArrow);

    FakeResizeObserver.instances.at(-1).emit(2_000, 300);
    await runtime.nextTick();
    assert.match(origin.style.transform, /translate\(0px, 100px\)/);
    image.dispatchEvent(new environment.dom.window.Event('load'));
    await runtime.nextTick();
    await runtime.nextTick();
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, [['41']]);

    app.unmount();
    image.dispatchEvent(new environment.dom.window.Event('error'));
    await runtime.nextTick();
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, []);
    assert.equal(FakeResizeObserver.instances.at(-1).disconnected, true);

    const failedRoot = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(failedRoot);
    const failedApp = runtime.createApp(runtime.default, {
      content: {
        objectUrl: 'https://onlypreview.invalid/broken.png',
        naturalWidth: 10,
        naturalHeight: 10
      },
      alt: 'Broken fixture',
      reportingRevision: '42'
    });
    failedApp.mount(failedRoot);
    await runtime.nextTick();
    failedRoot
      .querySelector('[name="onlypreview__imageContent"]')
      .dispatchEvent(new environment.dom.window.Event('error'));
    await runtime.nextTick();
    await runtime.nextTick();
    assert.equal(failedRoot.querySelector('[name="onlypreview__imageContent"]'), null);
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, [
      ['42', 'IMAGE_DECODE_FAILED']
    ]);
    failedApp.unmount();
  } finally {
    delete globalThis.__onlyPreviewMediaComponentHarness;
    environment.restore();
  }
});

test('MediaPreview waits for metadata, reports native failure truth, and tears down before stale events', async () => {
  const environment = installMediaPreviewDom();
  const operations = [];
  installMediaElementMethods(environment.dom, operations);
  try {
    globalThis.__onlyPreviewMediaComponentHarness = { ready: [], errors: [] };
    const runtime = await import(
      `${pathToFileURL(join(buildRoot, 'mediaPreview.mjs')).href}?case=media-component`
    );
    const state = runtime.reactive({
      kind: 'audio',
      assetUrl: 'bitterless-preview://asset/revision-51.mp3',
      name: 'Fixture audio',
      reportingRevision: '51'
    });
    const wrapper = runtime.defineComponent({
      setup: () => () => runtime.h(runtime.default, state)
    });
    const root = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(root);
    const app = runtime.createApp(wrapper);
    app.mount(root);
    await runtime.nextTick();
    await runtime.nextTick();

    let player = root.querySelector('[name="onlypreview__audioPlayer"]');
    assert.ok(player);
    assert.equal(player.controls, true);
    assert.equal(player.preload, 'metadata');
    assert.equal(player.getAttribute('aria-label'), 'Audio player for Fixture audio');
    assert.equal(player.getAttribute('src'), state.assetUrl);
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, []);

    player.dispatchEvent(new environment.dom.window.Event('loadedmetadata'));
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, [['51']]);

    state.assetUrl = 'bitterless-preview://asset/revision-52.mp3';
    state.reportingRevision = '52';
    Object.defineProperty(player, 'error', { configurable: true, value: { code: 2 } });
    player.dispatchEvent(new environment.dom.window.Event('error'));
    await runtime.nextTick();
    await runtime.nextTick();
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, []);
    player = root.querySelector('[name="onlypreview__audioPlayer"]');
    assert.ok(player, 'the new revision must not inherit the old failed player state');
    player.dispatchEvent(new environment.dom.window.Event('loadedmetadata'));
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, [['51'], ['52']]);

    Object.defineProperty(player, 'error', { configurable: true, value: { code: 3 } });
    player.dispatchEvent(new environment.dom.window.Event('error'));
    await runtime.nextTick();
    await runtime.nextTick();
    assert.equal(root.querySelector('[name="onlypreview__audioPlayer"]'), null);
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, [
      ['52', 'MEDIA_DECODE_FAILED']
    ]);
    player.dispatchEvent(new environment.dom.window.Event('loadedmetadata'));
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.ready, [['51'], ['52']]);

    const readyBeforeUnmount = globalThis.__onlyPreviewMediaComponentHarness.ready.length;
    app.unmount();
    player.dispatchEvent(new environment.dom.window.Event('loadedmetadata'));
    player.dispatchEvent(new environment.dom.window.Event('error'));
    await runtime.nextTick();
    assert.equal(globalThis.__onlyPreviewMediaComponentHarness.ready.length, readyBeforeUnmount);
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, [
      ['52', 'MEDIA_DECODE_FAILED']
    ]);
    assert.ok(operations.some(([, operation]) => operation === 'pause'));
  } finally {
    delete globalThis.__onlyPreviewMediaComponentHarness;
    environment.restore();
  }
});

test('MediaPreview teardown order is pause, remove src, load and its metadata deadline is terminal', async () => {
  const environment = installMediaPreviewDom();
  const operations = [];
  installMediaElementMethods(environment.dom, operations);
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { active: true, callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.active = false;
  };
  try {
    globalThis.__onlyPreviewMediaComponentHarness = { ready: [], errors: [] };
    const runtime = await import(
      `${pathToFileURL(join(buildRoot, 'mediaPreview.mjs')).href}?case=media-timeout`
    );
    const root = environment.dom.window.document.createElement('div');
    environment.dom.window.document.body.append(root);
    const app = runtime.createApp(runtime.default, {
      kind: 'video',
      assetUrl: 'bitterless-preview://asset/revision-61.mp4',
      name: 'Fixture video',
      reportingRevision: '61'
    });
    app.mount(root);
    await runtime.nextTick();
    await runtime.nextTick();
    const player = root.querySelector('[name="onlypreview__videoPlayer"]');
    assert.ok(player);
    assert.equal(player.getAttribute('aria-label'), 'Video player for Fixture video');
    const mediaTimer = timers.find((timer) => timer.delay === 30_000);
    assert.ok(mediaTimer);

    const originalRemoveAttribute = player.removeAttribute.bind(player);
    const originalRemoveEventListener = player.removeEventListener.bind(player);
    player.removeEventListener = (type, listener, options) => {
      if (type === 'loadedmetadata' || type === 'error') {
        operations.push([player, `remove-${type}`]);
      }
      originalRemoveEventListener(type, listener, options);
    };
    player.removeAttribute = (name) => {
      if (name === 'src') operations.push([player, 'remove-src']);
      originalRemoveAttribute(name);
    };
    operations.length = 0;
    mediaTimer.callback();
    assert.deepEqual(
      operations.slice(0, 5).map(([, operation]) => operation),
      ['remove-loadedmetadata', 'remove-error', 'pause', 'remove-src', 'load']
    );
    await runtime.nextTick();
    await runtime.nextTick();
    assert.equal(root.querySelector('[name="onlypreview__videoPlayer"]'), null);
    assert.deepEqual(globalThis.__onlyPreviewMediaComponentHarness.errors, [
      ['61', 'MEDIA_READ_FAILED']
    ]);
    app.unmount();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    delete globalThis.__onlyPreviewMediaComponentHarness;
    environment.restore();
  }
});
