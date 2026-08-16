import type {
  MonitoringAnomalyCursor,
  MonitoringAnomalyFilterState,
  MonitoringDetailProjection,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';
import {
  monitoringSampleIdentity,
  sameMonitoringSampleIdentity,
  type MonitoringSampleIdentity
} from './monitoringIntegrity.service';
import { monitoringSampleMatches } from './monitoringPresentation.service';

export const monitoringAnomalyOlder = (
  row: Pick<MonitoringSampleProjection, 'bucket_sequence' | 'config_id' | 'config_revision'>,
  cursor: MonitoringAnomalyCursor
): boolean =>
  BigInt(row.bucket_sequence) < BigInt(cursor.bucket_sequence) ||
  (row.bucket_sequence === cursor.bucket_sequence &&
    BigInt(row.config_id) < BigInt(cursor.config_id)) ||
  (row.bucket_sequence === cursor.bucket_sequence &&
    row.config_id === cursor.config_id &&
    row.config_revision < cursor.config_revision);

export const monitoringSamplePageMatches = (input: {
  rows: MonitoringSampleProjection[];
  detail: MonitoringDetailProjection;
  revision: number;
  before: string | null;
  next: string | null;
  pageSize: number;
  identity: MonitoringSampleIdentity | null;
  existing?: MonitoringSampleProjection[];
}): boolean => {
  const identity =
    input.identity ?? (input.rows[0] ? monitoringSampleIdentity(input.rows[0]) : null);
  const existingKeys = new Set((input.existing ?? []).map((row) => row.bucket_sequence));
  return (
    input.rows.length <= input.pageSize &&
    (!input.next || input.rows.length === input.pageSize) &&
    (!input.next || input.next === input.rows.at(-1)?.bucket_sequence) &&
    (!input.before ||
      input.rows.every((row) => BigInt(row.bucket_sequence) < BigInt(input.before as string))) &&
    (!input.next || !input.before || BigInt(input.next) < BigInt(input.before)) &&
    input.rows.every(
      (row, index) =>
        monitoringSampleMatches(row, input.detail, input.revision) &&
        (!identity || sameMonitoringSampleIdentity(row, identity)) &&
        !existingKeys.has(row.bucket_sequence) &&
        (index === 0 || BigInt(row.bucket_sequence) < BigInt(input.rows[index - 1].bucket_sequence))
    )
  );
};

export const monitoringAnomalyPageMatches = (input: {
  rows: MonitoringSampleProjection[];
  before: MonitoringAnomalyCursor | null;
  next: MonitoringAnomalyCursor | null;
  pageSize: number;
  configId: string;
  states: MonitoringAnomalyFilterState[];
  existing?: MonitoringSampleProjection[];
}): boolean => {
  const revisionIdentity = new Map<string, string>();
  const identity = (row: MonitoringSampleProjection): string =>
    JSON.stringify([
      row.name,
      row.asset_key,
      row.component_id,
      row.component_version,
      row.schema_hash,
      row.metric_kind,
      row.detector_version,
      row.zscore_threshold
    ]);
  for (const row of input.existing ?? []) {
    revisionIdentity.set(`${row.config_id}:${row.config_revision}`, identity(row));
  }
  const existingKeys = new Set(
    (input.existing ?? []).map(
      (row) => `${row.bucket_sequence}:${row.config_id}:${row.config_revision}`
    )
  );
  const last = input.rows.at(-1);
  return (
    input.rows.length <= input.pageSize &&
    (!input.next || input.rows.length === input.pageSize) &&
    (!input.next ||
      (input.next.bucket_sequence === last?.bucket_sequence &&
        input.next.config_id === last?.config_id &&
        input.next.config_revision === last?.config_revision)) &&
    (!input.next || !input.before || monitoringAnomalyOlder(input.next, input.before)) &&
    input.rows.every((row, index) => {
      const prior = input.rows[index - 1];
      const key = `${row.bucket_sequence}:${row.config_id}:${row.config_revision}`;
      const revisionKey = `${row.config_id}:${row.config_revision}`;
      const priorIdentity = revisionIdentity.get(revisionKey);
      const rowIdentity = identity(row);
      revisionIdentity.set(revisionKey, rowIdentity);
      return (
        (!input.configId || row.config_id === input.configId) &&
        (!input.states.length ||
          input.states.includes(row.state as MonitoringAnomalyFilterState)) &&
        (!input.before || monitoringAnomalyOlder(row, input.before)) &&
        (priorIdentity === undefined || priorIdentity === rowIdentity) &&
        !existingKeys.has(key) &&
        (index === 0 ||
          monitoringAnomalyOlder(row, {
            bucket_sequence: prior.bucket_sequence,
            config_id: prior.config_id,
            config_revision: prior.config_revision
          }))
      );
    })
  );
};
