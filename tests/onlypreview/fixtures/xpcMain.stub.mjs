export const xpcMain = {
  broadcast: (eventName, params) => {
    globalThis.__onlyPreviewIndexStateBroadcasts?.push({ eventName, params });
  }
};
