import { BaseWindow } from 'electron';
import { basename } from 'node:path';
import { OnlyPreviewSingleFileSurface } from './onlyPreviewSingleFileSurface.service';

/** Native independent window; all file rendering and authority live in the shared content surface. */
export const openIndiPreviewFile = async (
  absolutePath: string,
  options: { line?: number; fragment?: string } = {}
): Promise<void> => {
  const window = new BaseWindow({
    title: basename(absolutePath), width: 1100, height: 800,
    minWidth: 800, minHeight: 600, show: false
  });
  let surface: OnlyPreviewSingleFileSurface | null = null;
  try {
    surface = new OnlyPreviewSingleFileSurface({
      window, path: absolutePath, ...options,
      isOpen: () => !window.isDestroyed(),
      bounds: () => {
        const [width, height] = window.getContentSize();
        return { x: 0, y: 0, width, height };
      },
      attach: (container) => window.contentView.addChildView(container)
    });
    window.on('resize', () => surface?.refresh());
    window.once('closed', () => surface?.dispose());
    await surface.open();
    if (window.isDestroyed()) throw new Error('IndiPreview closed during startup.');
    surface.setActive(true);
    window.show();
    window.focus();
  } catch (error) {
    surface?.dispose();
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
};
