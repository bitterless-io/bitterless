// The exact label set the New Folder dialog reads, so the test asserts the real message shapes.
const onlyPreviewFileMenu = {
  newFolderTitle: 'New Folder',
  newFolderDestination: 'in “{name}”',
  newFolderNameLabel: 'Name',
  newFolderConfirm: 'OK',
  newFolderCancel: 'Cancel',
  newFolderExistsTitle: 'Name already in use',
  newFolderExistsMessage: '“{name}” already exists in “{parent}”.\nEnter a different name.',
  newFolderExistsRootMessage: '“{name}” already exists here.\nEnter a different name.',
  newFolderInvalidTitle: 'Name cannot be used',
  newFolderFailureTitle: 'Could not create folder',
  newFolderFailureMessage: 'The folder could not be created. The Project may have changed.',
  renameInvalidMessage: 'This name cannot be used on Windows or macOS.',
  alertOk: 'OK'
};

export const i18nHelper = {
  getMessages: () => ({ app: { onlyPreviewFileMenu } })
};
