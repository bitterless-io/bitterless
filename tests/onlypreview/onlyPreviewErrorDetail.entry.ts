// One bundle so the test can construct the SAME `OnlyPreviewContractError` class instance that
// `describeOnlyPreviewErrorDetail`'s `instanceof` check requires. Two separate esbuild bundles
// would each carry their own copy of the class and the branch would never match (same pattern as
// `alertNewFolder.entry.ts`).
export {
  describeOnlyPreviewErrorDetail,
  formatOnlyPreviewErrorDetail,
  isEmptyOnlyPreviewErrorDetail
} from '../../src/renderer/onlypreview/shell/src/onlyPreviewErrorDetail.service';
export { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
