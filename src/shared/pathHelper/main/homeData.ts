import { app } from 'electron';
import * as path from 'path';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';

/**
 * The home-level data root — `~/.bitterless`, `~/.bitterless_preview`, …
 *
 * Ral 2026-09-20:「~ 下的 data 目录应该通过 pathhelper 通用的方式获取」. `userData` came from the path
 * helper while the home directory was derived inside `main/paths/appData.ts`, so "where does the app
 * keep the owner's data" had two possible answers depending on which module you asked. One shape,
 * one owner: the derivation lives **here**, and `appData.ts` owns which subdirectories exist under it
 * and ensures them at boot.
 *
 * **Its own module, not a method on `PathMainHelper`**, for two reasons. `XpcMainHandler` registers
 * every public method as an XPC channel, and this has to be callable **synchronously** during boot,
 * long before a renderer exists. And `pathMain.helper.ts` reads `import.meta.env`, which is a Vite
 * build-time construct — anything importing it cannot be evaluated as plain CommonJS, which is how
 * the directory-contract tests load `appData.ts`. The helper re-exports this for the renderer.
 *
 * Derived from the profile's `appName` rather than a hand-written table: that name IS the `userData`
 * directory name, so lowercasing it already yields the required product-plus-environment shape, and
 * a sixth edition gets its directory for free without a second list to keep in sync.
 *
 * `app.getPath('home')`, not `os.homedir()`: E2E redirects the home path, and a test run must never
 * write into a real `~/.bitterless…` directory.
 */
export const homeDataRoot = (): string =>
  path.join(app.getPath('home'), `.${getRuntimeProfile().appName.toLowerCase()}`);

/** A path under the home data root. The directory is created by `ensureAppData()`, not here. */
export const homeDataIn = (...segments: string[]): string => path.join(homeDataRoot(), ...segments);
