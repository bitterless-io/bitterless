import { XpcMainHandler } from 'electron-xpc/main';
import type { WindowLayout } from '@shared/window/window.types';
declare class WindowControlHandler extends XpcMainHandler {
    minimizeWindow(params: {
        windowId: number;
    }): Promise<void>;
    maximizeWindow(params: {
        windowId: number;
    }): Promise<void>;
    closeWindow(params: {
        windowId: number;
    }): Promise<void>;
    isMaximized(params: {
        windowId: number;
    }): Promise<boolean>;
    getWindowBounds(params: {
        windowId: number;
    }): Promise<WindowLayout | null>;
    setWindowBounds(params: {
        windowId: number;
        layout: WindowLayout;
    }): Promise<void>;
    saveWindowLayout(params: {
        subKey: string;
        layout: WindowLayout;
    }): Promise<void>;
    loadWindowLayout(params: {
        subKey: string;
    }): Promise<WindowLayout | null>;
}
export declare const windowControlHandler: WindowControlHandler;
export type { WindowControlHandler };
