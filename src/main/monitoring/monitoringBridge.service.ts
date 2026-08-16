import type {
  MonitoringBridge,
  MonitoringAnomalyCursor,
  MonitoringAnomalyFilterState,
  MonitoringAnomalyListInput,
  MonitoringDetailProjection,
  MonitoringListInput,
  MonitoringRevisionInput,
  MonitoringSampleListInput,
  MonitoringSaveInput
} from '@shared/monitoring/monitoringBridge.type';
import type { SnipingBridgeError, SnipingBridgeResult } from '@shared/sniping/snipingBridge.type';
import { type SnipingRelayClient } from '../sniping/snipingRelay.client';
import { SnipingResponseError } from '../sniping/snipingResponse.validation';
import {
  MonitoringInputError,
  parseMonitoringAnomalyListInput,
  parseMonitoringIdentityInput,
  parseMonitoringListInput,
  parseMonitoringRevisionInput,
  parseMonitoringSampleListInput,
  parseMonitoringSaveInput
} from './monitoringRequest.validation';
import {
  parseMonitoringAnomalyListResponse,
  parseMonitoringDetailResponse,
  parseMonitoringListResponse,
  parseMonitoringSampleListResponse
} from './monitoringResponse.validation';

export const MONITORING_CORE_ROUTES = {
  list: { method: 'POST', path: '/sniping/monitor/list' },
  get: { method: 'POST', path: '/sniping/monitor/detail' },
  save: { method: 'POST', path: '/sniping/monitor/save' },
  state: { method: 'POST', path: '/sniping/monitor/set-desired-state' },
  samples: { method: 'POST', path: '/sniping/monitor/sample/list' },
  anomalies: { method: 'POST', path: '/sniping/monitor/anomaly/list' }
} as const;

const invalidInput = <T>(): SnipingBridgeResult<T> => ({
  ok: false,
  error: {
    code: 'MONITORING_BRIDGE_INPUT_INVALID',
    message: 'The Monitoring request is invalid.',
    status: null,
    retryable: false
  }
});

const rendererIssuePath =
  /^(?:\/(?:page|page_size|search_text|config_id|name|token_address|zscore_threshold|expected_revision|config_revision|before_bucket_sequence|states|cursor)|\/states\/[0-6]|\/cursor\/(?:bucket_sequence|config_id|config_revision))$/;

const sanitizeError = (error: SnipingBridgeError): SnipingBridgeError => {
  const issues = error.issues?.filter((item) => rendererIssuePath.test(item.path));
  return {
    code: error.code,
    message: error.message,
    status: error.status,
    retryable: error.retryable,
    ...(issues?.length ? { issues } : {})
  };
};

const responseError = (): never => {
  throw new SnipingResponseError();
};

const listParser = (input: MonitoringListInput) => (value: unknown) => {
  const result = parseMonitoringListResponse(value);
  const page = input.page ?? 1;
  const pageSize = input.page_size ?? 20;
  const offset = (page - 1) * pageSize;
  const expectedLength = Math.min(pageSize, Math.max(0, result.total - offset));
  const search = input.search_text?.toLocaleLowerCase();
  if (
    result.page !== page ||
    result.page_size !== pageSize ||
    result.list.length > pageSize ||
    (result.total === 0 && result.list.length !== 0) ||
    (result.list.length === 0 && result.total > offset) ||
    (result.list.length > 0 && result.list.length !== expectedLength) ||
    (search !== undefined &&
      result.list.some(
        (item) =>
          !item.name.toLocaleLowerCase().includes(search) &&
          !item.token_address.includes(search.toLowerCase())
      ))
  )
    responseError();
  return result;
};

const detailParser = (configId: string) => (value: unknown) => {
  const result = parseMonitoringDetailResponse(value);
  if (result.config_id !== configId) responseError();
  return result;
};

const pristineRevision = (result: MonitoringDetailProjection): boolean =>
  result.latest === null &&
  result.readiness.state === 'WARMING' &&
  result.readiness.baseline_count === 0 &&
  result.available_revisions[0]?.revision === result.config_revision &&
  result.available_revisions[0]?.has_samples === false;

const retainsPriorRevision = (
  result: MonitoringDetailProjection,
  expectedRevision: number
): boolean =>
  expectedRevision === 0 ||
  result.available_revisions.some((revision) => revision.revision === expectedRevision);

const saveParser = (input: MonitoringSaveInput) => (value: unknown) => {
  const result = parseMonitoringDetailResponse(value);
  const expectedName = input.name ?? `BSC ${input.token_address}`;
  if (
    (input.config_id !== undefined && result.config_id !== input.config_id) ||
    result.config_revision !== input.expected_revision + 1 ||
    result.token_address !== input.token_address ||
    result.asset_key !== `eip155:56:${input.token_address}` ||
    result.zscore_threshold !== input.zscore_threshold ||
    result.name !== expectedName ||
    result.primary_region !== 'sg' ||
    result.standby_region !== 'jp' ||
    result.desired_state !== 'disabled' ||
    result.status !== 'Stopped' ||
    !pristineRevision(result) ||
    !retainsPriorRevision(result, input.expected_revision)
  )
    responseError();
  return result;
};

const stateParser =
  (input: MonitoringRevisionInput, desiredState: 'armed' | 'disabled') => (value: unknown) => {
    const result = parseMonitoringDetailResponse(value);
    if (
      result.config_id !== input.config_id ||
      result.config_revision !== input.expected_revision + 1 ||
      result.desired_state !== desiredState ||
      result.status !== (desiredState === 'armed' ? 'Monitoring' : 'Stopped') ||
      !pristineRevision(result) ||
      !retainsPriorRevision(result, input.expected_revision)
    )
      responseError();
    return result;
  };

const sampleParser = (input: MonitoringSampleListInput) => (value: unknown) => {
  const result = parseMonitoringSampleListResponse(value);
  const pageSize = input.page_size ?? 100;
  const first = result.list[0];
  if (
    result.list.length > pageSize ||
    result.list.some(
      (item) =>
        item.config_id !== input.config_id ||
        item.config_revision !== input.config_revision ||
        (first !== undefined &&
          (item.asset_key !== first.asset_key ||
            item.component_id !== first.component_id ||
            item.component_version !== first.component_version ||
            item.schema_hash !== first.schema_hash ||
            item.metric_kind !== first.metric_kind ||
            item.detector_version !== first.detector_version ||
            item.zscore_threshold !== first.zscore_threshold)) ||
        (input.before_bucket_sequence !== undefined &&
          BigInt(item.bucket_sequence) >= BigInt(input.before_bucket_sequence))
    ) ||
    (result.next_before_bucket_sequence !== null && result.list.length !== pageSize) ||
    (result.next_before_bucket_sequence !== null &&
      input.before_bucket_sequence !== undefined &&
      BigInt(result.next_before_bucket_sequence) >= BigInt(input.before_bucket_sequence))
  )
    responseError();
  return result;
};

const anomalyTupleOlder = (
  item: { bucket_sequence: string; config_id: string; config_revision: number },
  cursor: MonitoringAnomalyCursor
): boolean =>
  BigInt(item.bucket_sequence) < BigInt(cursor.bucket_sequence) ||
  (item.bucket_sequence === cursor.bucket_sequence &&
    BigInt(item.config_id) < BigInt(cursor.config_id)) ||
  (item.bucket_sequence === cursor.bucket_sequence &&
    item.config_id === cursor.config_id &&
    item.config_revision < cursor.config_revision);

const anomalyParser = (input: MonitoringAnomalyListInput) => (value: unknown) => {
  const result = parseMonitoringAnomalyListResponse(value);
  const pageSize = input.page_size ?? 50;
  const revisionIdentity = new Map<string, string>();
  const identityDrift = result.list.some((item) => {
    const key = `${item.config_id}:${item.config_revision}`;
    const identity = JSON.stringify([
      item.name,
      item.asset_key,
      item.component_id,
      item.component_version,
      item.schema_hash,
      item.metric_kind,
      item.detector_version,
      item.zscore_threshold
    ]);
    const prior = revisionIdentity.get(key);
    revisionIdentity.set(key, identity);
    return prior !== undefined && prior !== identity;
  });
  if (
    result.list.length > pageSize ||
    identityDrift ||
    result.list.some(
      (item) =>
        (input.config_id !== undefined && item.config_id !== input.config_id) ||
        (input.states !== undefined &&
          !input.states.includes(item.state as MonitoringAnomalyFilterState)) ||
        (input.cursor !== undefined && !anomalyTupleOlder(item, input.cursor))
    ) ||
    (result.next_cursor !== null && result.list.length !== pageSize) ||
    (result.next_cursor !== null &&
      input.cursor !== undefined &&
      !anomalyTupleOlder(result.next_cursor, input.cursor))
  )
    responseError();
  return result;
};

export class MonitoringBridgeService implements MonitoringBridge {
  constructor(private readonly relay: SnipingRelayClient) {}

  list: MonitoringBridge['list'] = async (input = {}) =>
    await this.safe(async () => {
      const body = parseMonitoringListInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.list,
        body,
        parse: listParser(body)
      });
    });

  get: MonitoringBridge['get'] = async (input) =>
    await this.safe(async () => {
      const body = parseMonitoringIdentityInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.get,
        body,
        parse: detailParser(body.config_id)
      });
    });

  save: MonitoringBridge['save'] = async (input) =>
    await this.safe(async () => {
      const body = parseMonitoringSaveInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.save,
        body: { ...body, primary_region: 'sg', standby_region: 'jp' },
        parse: saveParser(body)
      });
    });

  start: MonitoringBridge['start'] = async (input) => await this.setState(input, 'armed');

  stop: MonitoringBridge['stop'] = async (input) => await this.setState(input, 'disabled');

  listSamples: MonitoringBridge['listSamples'] = async (input) =>
    await this.safe(async () => {
      const body = parseMonitoringSampleListInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.samples,
        body,
        parse: sampleParser(body)
      });
    });

  listAnomalies: MonitoringBridge['listAnomalies'] = async (input = {}) =>
    await this.safe(async () => {
      const body = parseMonitoringAnomalyListInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.anomalies,
        body,
        parse: anomalyParser(body)
      });
    });

  private setState = async (
    input: MonitoringRevisionInput,
    desiredState: 'armed' | 'disabled'
  ): ReturnType<MonitoringBridge['start']> =>
    await this.safe(async () => {
      const body = parseMonitoringRevisionInput(input);
      return await this.relay.request({
        ...MONITORING_CORE_ROUTES.state,
        body: { ...body, desired_state: desiredState },
        parse: stateParser(body, desiredState)
      });
    });

  private safe = async <T>(
    operation: () => Promise<SnipingBridgeResult<T>>
  ): Promise<SnipingBridgeResult<T>> => {
    try {
      const result = await operation();
      return result.ok ? result : { ok: false, error: sanitizeError(result.error) };
    } catch (error) {
      if (error instanceof MonitoringInputError) return invalidInput<T>();
      throw error;
    }
  };
}
