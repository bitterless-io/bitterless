import type {
  SnipingBridge,
  SnipingBridgeResult,
} from '@shared/sniping/snipingBridge.type';
import {
  parseSnipingActivityListInput,
  parseSnipingConfigIdentityInput,
  parseSnipingConfigListInput,
  parseSnipingConfigSaveInput,
  parseSnipingExactRequestInput,
  parseSnipingReleaseConfigInput,
  parseSnipingRevisionInput,
  parseSnipingShadowRequestInput,
  parseSnipingSimulationEventListInput,
  parseSnipingSimulationListInput,
  SnipingInputError,
} from './snipingRequest.validation';
import {
  parseSnipingActivityResponse,
  parseSnipingComponentsResponse,
  parseSnipingConfigDetailResponse,
  parseSnipingConfigListResponse,
  parseSnipingRuntimeListResponse,
  parseSnipingSimulationEventListResponse,
  parseSnipingSimulationListResponse,
  parseSnipingSimulationRequestResponse,
  parseSnipingValidationResponse,
} from './snipingResponse.validation';
import { SNIPING_CORE_ROUTES, type SnipingRelayClient } from './snipingRelay.client';

const invalidInput = <T>(): SnipingBridgeResult<T> => ({
  ok: false,
  error: {
    code: 'SNIPING_BRIDGE_INPUT_INVALID',
    message: 'The Sniping request is invalid.',
    status: null,
    retryable: false,
  },
});

export class SnipingBridgeService implements SnipingBridge {
  constructor(private readonly relay: SnipingRelayClient) {}

  listComponents: SnipingBridge['listComponents'] = async () => await this.relay.request({
    ...SNIPING_CORE_ROUTES.listComponents,
    parse: parseSnipingComponentsResponse,
  });

  listConfigs: SnipingBridge['listConfigs'] = async (input = {}) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listConfigs,
      body: parseSnipingConfigListInput(input),
      parse: parseSnipingConfigListResponse,
    }));

  getConfig: SnipingBridge['getConfig'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.getConfig,
      body: parseSnipingConfigIdentityInput(input),
      parse: parseSnipingConfigDetailResponse,
    }));

  validateConfig: SnipingBridge['validateConfig'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.validateConfig,
      body: parseSnipingReleaseConfigInput(input),
      parse: parseSnipingValidationResponse,
    }));

  saveConfig: SnipingBridge['saveConfig'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.saveConfig,
      body: parseSnipingConfigSaveInput(input),
      parse: parseSnipingConfigDetailResponse,
    }));

  startMonitoring: SnipingBridge['startMonitoring'] = async (input) => await this.desired(input, 'armed');

  stopMonitoring: SnipingBridge['stopMonitoring'] = async (input) => await this.desired(input, 'disabled');

  listRuntimes: SnipingBridge['listRuntimes'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listRuntimes,
      body: parseSnipingConfigIdentityInput(input),
      parse: parseSnipingRuntimeListResponse,
    }));

  listSimulationEvents: SnipingBridge['listSimulationEvents'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listSimulationEvents,
      body: parseSnipingSimulationEventListInput(input),
      parse: parseSnipingSimulationEventListResponse,
    }));

  requestExactSimulation: SnipingBridge['requestExactSimulation'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.requestExactSimulation,
      body: parseSnipingExactRequestInput(input),
      parse: parseSnipingSimulationRequestResponse,
    }));

  listExactSimulations: SnipingBridge['listExactSimulations'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listExactSimulations,
      body: parseSnipingSimulationListInput(input),
      parse: parseSnipingSimulationListResponse,
    }));

  requestShadowSimulation: SnipingBridge['requestShadowSimulation'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.requestShadowSimulation,
      body: parseSnipingShadowRequestInput(input),
      parse: parseSnipingSimulationRequestResponse,
    }));

  listShadowSimulations: SnipingBridge['listShadowSimulations'] = async (input) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listShadowSimulations,
      body: parseSnipingSimulationListInput(input),
      parse: parseSnipingSimulationListResponse,
    }));

  listActivity: SnipingBridge['listActivity'] = async (input = {}) => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.listActivity,
      body: parseSnipingActivityListInput(input),
      parse: parseSnipingActivityResponse,
    }));

  private desired = async (
    input: Parameters<SnipingBridge['startMonitoring']>[0],
    desiredState: 'armed' | 'disabled',
  ): ReturnType<SnipingBridge['startMonitoring']> => await this.safe(async () =>
    await this.relay.request({
      ...SNIPING_CORE_ROUTES.setDesiredState,
      body: { ...parseSnipingRevisionInput(input), desired_state: desiredState },
      parse: parseSnipingConfigDetailResponse,
    }));

  private safe = async <T>(operation: () => Promise<SnipingBridgeResult<T>>): Promise<SnipingBridgeResult<T>> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SnipingInputError) return invalidInput<T>();
      throw error;
    }
  };
}
