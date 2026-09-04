// The exact label set the delete dialog reads, so the test asserts real message shapes.
const onlyPreviewFileMenu = {
  delete: 'Delete…',
  deleteManyMenu: 'Delete {count} Items…',
  deleteConfirmFileTitle: 'Delete “{name}”?',
  deleteConfirmFolderTitle: 'Delete “{name}” and everything inside it?',
  deleteConfirmManyTitle: 'Delete {count} items?',
  deleteConfirmSingleMessage: 'It will be removed from disk immediately.\nThis cannot be undone.',
  deleteConfirmManyMessage: 'They will be removed from disk immediately.\nThis cannot be undone.',
  deleteMoreLabel: '…and {count} more',
  deleteFolderTag: 'folder',
  deleteConfirmHintMac: '⌘⏎',
  deleteConfirmHint: 'Ctrl+⏎',
  deleteConfirmButton: 'Delete',
  deleteCancelButton: 'Cancel',
  deleteFailureTitle: 'Could not delete file',
  deleteFailureMessage: 'The file could not be deleted. It may have moved or changed.',
  deletePartialTitle: 'Some items were not deleted',
  deletePartialMessage: '{done} of {total} items were deleted.\n“{name}” could not be deleted.',
  deleteRootRefusedTitle: 'The Project folder cannot be deleted',
  deleteRootRefusedMessage: 'Select the items inside it instead.',
  deleteTooManyTitle: 'Too many items selected',
  deleteTooManyMessage: 'Delete at most {limit} items at a time.',
  alertOk: 'OK'
};

export const i18nHelper = {
  getMessages: () => ({ app: { onlyPreviewFileMenu } })
};
