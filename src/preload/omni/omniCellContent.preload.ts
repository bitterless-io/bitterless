// Preload for omni browser cell (raw web content).
// NOTE: contextIsolation:true means assignments to window.* here are NOT visible to the page's
// main world. Notification interception is therefore done via executeJavaScript (main world)
// in omniWindow.helper.ts on the 'dom-ready' event instead.
import './omniCellActiveFrame.sdk';
