type OpenExplicitTarget = (target: string, options?: { line?: number; fragment?: string }) => Promise<void>;

let openExplicitTarget: OpenExplicitTarget | null = null;

export const registerOnlyPreviewExplicitTarget = (handler: OpenExplicitTarget): void => {
  openExplicitTarget = handler;
};

export const openRegisteredOnlyPreviewExplicitTarget = async (
  target: string,
  options?: { line?: number; fragment?: string }
): Promise<void> => {
  if (!openExplicitTarget) throw new Error('OnlyPreview explicit target handler is unavailable');
  await openExplicitTarget(target, options);
};
