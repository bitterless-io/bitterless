declare module '@main/xpc/todoWindow.handler' {
  export type TodoWindowHandler =
    import('./contracts/xpc/todoWindow.handler').TodoWindowHandler;
}

declare module '@main/xpc/windowControl.handler' {
  export type WindowControlHandler =
    import('./contracts/xpc/windowControl.handler').WindowControlHandler;
}
