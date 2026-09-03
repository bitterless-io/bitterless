// State lives on `globalThis` because esbuild inlines this stub into each bundle under test, so the
// bundle and the test file would otherwise hold separate module instances.
const stubState = (globalThis.__bitterlessXpcMainStub ??= { broadcasts: [] });

export const state = stubState;

export const resetXpcMainStub = () => {
  stubState.broadcasts.length = 0;
};

export const xpcMain = {
  broadcast: (eventName, params) => {
    stubState.broadcasts.push({ eventName, params });
    // The project-index-state suite predates `state` and reads this global directly.
    globalThis.__onlyPreviewIndexStateBroadcasts?.push({ eventName, params });
  }
};
