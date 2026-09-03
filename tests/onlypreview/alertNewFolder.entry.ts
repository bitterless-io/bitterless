// One bundle so the test throws the SAME `OnlyPreviewContractError` class the dialog service checks
// with `instanceof`. Two separate bundles would each carry their own copy and the conflict branch
// would never be reached.
export { presentOnlyPreviewNewFolderDialog } from '@main/onlypreview/onlyPreviewNewFolderDialog.service';
export { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
