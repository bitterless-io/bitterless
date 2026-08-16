import type {
  MonitoringDetailProjection,
  MonitoringSaveInput
} from '@shared/monitoring/monitoringBridge.type';

export interface MonitoringDraft {
  name: string;
  tokenAddress: string;
  threshold: string;
}

export type MonitoringDraftResult =
  | { ok: true; input: MonitoringSaveInput }
  | { ok: false; error: string | null };

const address = /^0x[0-9a-f]{40}$/;

export const blankMonitoringDraft = (): MonitoringDraft => ({
  name: '',
  tokenAddress: '',
  threshold: '3.00'
});

export const validateMonitoringDraft = (
  draft: MonitoringDraft,
  editDetail: MonitoringDetailProjection | null,
  editMode: boolean,
  canEdit: boolean
): MonitoringDraftResult => {
  const tokenAddress = draft.tokenAddress.trim();
  const threshold = Number(draft.threshold);
  if (
    !address.test(tokenAddress) ||
    tokenAddress === '0x0000000000000000000000000000000000000000'
  ) {
    return { ok: false, error: 'MONITORING_ADDRESS_INVALID' };
  }
  if (
    !Number.isFinite(threshold) ||
    threshold < 2 ||
    threshold > 10 ||
    Number(threshold.toFixed(2)) !== threshold
  ) {
    return { ok: false, error: 'MONITORING_THRESHOLD_INVALID' };
  }
  const name = draft.name.trim();
  if ([...name].length > 128) return { ok: false, error: 'MONITORING_NAME_INVALID' };
  if (editMode && (!editDetail || !canEdit)) return { ok: false, error: null };
  return {
    ok: true,
    input: {
      ...(editMode && editDetail ? { config_id: editDetail.config_id } : {}),
      ...(name ? { name } : {}),
      token_address: tokenAddress,
      zscore_threshold: threshold,
      expected_revision: editMode && editDetail ? editDetail.config_revision : 0
    }
  };
};
