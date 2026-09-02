import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { OnlyPreviewLogService } from '@main/logging/onlyPreviewLog.service';

export const onlyPreviewLogService = new OnlyPreviewLogService({
  getProfile: getRuntimeProfile
});
