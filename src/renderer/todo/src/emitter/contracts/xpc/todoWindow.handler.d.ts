import { XpcMainHandler } from 'electron-xpc/main';
declare class TodoWindowHandler extends XpcMainHandler {
    private todoView;
    private standaloneWindow;
    private creationPromise;
    private resizeHandler;
    private windowStateController;
    private loadLayout;
    showTodoView(): Promise<void>;
    hideTodoView(): Promise<void>;
    openTodoWindow(): Promise<void>;
    private createStandaloneWindow;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    _destroyForAuth(): Promise<void>;
    destroyForHostQuit(): Promise<void>;
    isMaximized(): Promise<boolean>;
    setAlwaysOnTop(params: {
        enable: boolean;
    }): Promise<void>;
    reloadTodoData(): Promise<void>;
    private updateBounds;
}
export declare const todoWindowHandler: TodoWindowHandler;
export type { TodoWindowHandler };
