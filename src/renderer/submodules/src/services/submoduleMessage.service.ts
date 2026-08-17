// Preload and Main report failures as codes; every user-visible string is resolved here so the
// mini app stays translatable.
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  SubmoduleEntry,
  SubmoduleEntryErrorCode,
  SubmodulesErrorCode,
  SubmodulesOpenErrorCode
} from '@shared/submodules/submodules.type';

export const describeScanError = (code: SubmodulesErrorCode): string => {
  const messages = i18nHelper.submodules.error;
  switch (code) {
    case 'root-missing':
      return messages.rootMissing;
    case 'root-not-a-directory':
      return messages.rootNotADirectory;
    case 'gitmodules-missing':
      return messages.gitmodulesMissing;
    case 'gitmodules-unreadable':
      return messages.gitmodulesUnreadable;
    default:
      return messages.scanFailed;
  }
};

export const describeEntryError = (code: SubmoduleEntryErrorCode): string => {
  const messages = i18nHelper.submodules.error;
  switch (code) {
    case 'gitdir-unreadable':
      return messages.gitdirUnreadable;
    case 'head-malformed':
      return messages.headMalformed;
    default:
      return messages.headUnreadable;
  }
};

export const describeOpenError = (code: SubmodulesOpenErrorCode): string => {
  const messages = i18nHelper.submodules.error;
  switch (code) {
    case 'path-invalid':
    case 'path-missing':
      return messages.openPathMissing;
    default:
      return messages.ideNotFound;
  }
};

export const describeBranch = (entry: SubmoduleEntry): string => {
  const messages = i18nHelper.submodules.branch;
  if (entry.branch) return entry.branch;
  switch (entry.state) {
    case 'detached':
      return messages.detached;
    case 'uninitialized':
      return messages.uninitialized;
    case 'missing':
      return messages.missing;
    default:
      return messages.unknown;
  }
};
