import type {
  MonitoringDetailProjection,
  MonitoringListItem,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';

export type MonitoringSampleIdentity = Pick<
  MonitoringSampleProjection,
  | 'asset_key'
  | 'component_id'
  | 'component_version'
  | 'schema_hash'
  | 'metric_kind'
  | 'detector_version'
  | 'zscore_threshold'
>;

export const monitoringSampleIdentity = (
  sample: MonitoringSampleIdentity
): MonitoringSampleIdentity => ({
  asset_key: sample.asset_key,
  component_id: sample.component_id,
  component_version: sample.component_version,
  schema_hash: sample.schema_hash,
  metric_kind: sample.metric_kind,
  detector_version: sample.detector_version,
  zscore_threshold: sample.zscore_threshold
});

export const sameMonitoringSampleIdentity = (
  sample: MonitoringSampleIdentity,
  identity: MonitoringSampleIdentity
): boolean =>
  Object.entries(identity).every(
    ([key, value]) => sample[key as keyof MonitoringSampleIdentity] === value
  );

export const retainsMonitoringRevisionHistory = (
  next: MonitoringDetailProjection,
  prior: MonitoringDetailProjection
): boolean => {
  const nextByRevision = new Map(next.available_revisions.map((item) => [item.revision, item]));
  const oldestRetained = next.available_revisions.at(-1)?.revision ?? next.config_revision;
  return prior.available_revisions
    .filter((item) => item.revision >= oldestRetained)
    .every((item) => {
      const retained = nextByRevision.get(item.revision);
      return Boolean(
        retained &&
        retained.desired_state === item.desired_state &&
        retained.created_at === item.created_at &&
        (!item.has_samples || retained.has_samples)
      );
    });
};

const sameMonitoringImmutableIdentity = (
  next: MonitoringListItem,
  prior: MonitoringListItem
): boolean =>
  next.config_id === prior.config_id &&
  next.name === prior.name &&
  next.asset_key === prior.asset_key &&
  next.chain === prior.chain &&
  next.token_address === prior.token_address &&
  next.zscore_threshold === prior.zscore_threshold &&
  next.component_id === prior.component_id &&
  next.component_version === prior.component_version &&
  next.schema_hash === prior.schema_hash &&
  next.metric_kind === prior.metric_kind &&
  next.detector_version === prior.detector_version &&
  next.primary_region === prior.primary_region &&
  next.standby_region === prior.standby_region;

export const sameMonitoringRevisionIdentity = (
  next: MonitoringListItem,
  prior: MonitoringListItem
): boolean =>
  sameMonitoringImmutableIdentity(next, prior) &&
  next.config_revision === prior.config_revision &&
  next.updated_at === prior.updated_at &&
  next.desired_state === prior.desired_state &&
  next.status === prior.status;

export const sameMonitoringMutationIdentity = (
  next: MonitoringDetailProjection,
  prior: MonitoringDetailProjection
): boolean =>
  sameMonitoringImmutableIdentity(next, prior) && retainsMonitoringRevisionHistory(next, prior);

export const canRetainMonitoringSamples = (
  prior: MonitoringDetailProjection | null,
  next: MonitoringDetailProjection,
  selectedRevision: number | null,
  identity: MonitoringSampleIdentity | null
): boolean =>
  prior !== null &&
  selectedRevision === prior.config_revision &&
  next.config_revision === prior.config_revision &&
  sameMonitoringRevisionIdentity(next, prior) &&
  retainsMonitoringRevisionHistory(next, prior) &&
  (!identity || sameMonitoringSampleIdentity(next, identity));
