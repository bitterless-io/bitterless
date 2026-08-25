// The bundled Maestro Home tab needs only the XPC transport used by Bitterless Chat.
// Keep this separate from coach.preload: browser tabs must never inherit first-party bridges.
import 'electron-xpc/preload'
