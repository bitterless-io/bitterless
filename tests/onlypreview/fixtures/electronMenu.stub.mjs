// The application Find menu is the only OnlyPreview code that touches Electron's `Menu`, and the
// behaviour worth guarding is which accelerators the template carries and where an unclaimed chord
// is replayed. Both need a stub whose focus owners the test can move.
//
// State lives on `globalThis` because esbuild inlines this stub into the bundle under test, so the
// bundle and the test file each hold their own module instance. A module-scoped object would give
// the test a second copy whose writes the bundle never sees.
const stubState = (globalThis.__bitterlessElectronMenuStub ??= {
  applicationMenu: null,
  builtTemplate: null,
  focusedWindow: null,
  focusedWebContents: null
});

export const state = stubState;

export const resetElectronMenuStub = () => {
  stubState.applicationMenu = null;
  stubState.builtTemplate = null;
  stubState.focusedWindow = null;
  stubState.focusedWebContents = null;
};

export class Menu {
  constructor(template) {
    this.template = template;
  }

  static buildFromTemplate(template) {
    stubState.builtTemplate = template;
    return new Menu(template);
  }

  static setApplicationMenu(menu) {
    stubState.applicationMenu = menu;
  }
}

export class BaseWindow {
  static getFocusedWindow() {
    return stubState.focusedWindow;
  }
}

export const webContents = {
  getFocusedWebContents: () => stubState.focusedWebContents
};
