// Submodules reads and watches Git working copies from preload. The handler import instantiates
// its singleton, which auto-registers the `SubmodulesHandler` XPC channels.
import 'electron-xpc/preload';
import './submodules.handler';
