import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSnipingSimulationRequestResponse,
  SnipingResponseError,
} from '../../../src/main/sniping/snipingResponse.validation';
import { acceptedSnipingReport } from '../../../src/renderer/coin/src/views/sniping/snipingReport.service';

const HASH = 'a'.repeat(64);
const EVM_HASH = `0x${'b'.repeat(64)}`;
const ADDRESS = `0x${'1'.repeat(40)}`;
const EVENT_KEY = `bsc:56:${EVM_HASH}:${EVM_HASH}:0`;
const DATE = '2026-08-13T00:00:00.000Z';

const exactFixture = (): Record<string, any> => ({
  request_id: 'exact-1',
  config_id: '1',
  config_revision: 1,
  kind: 'exact',
  canonical_event_key: EVENT_KEY,
  shadow_policy: null,
  state: 'completed',
  attempt_count: 1,
  accepted_attempt_number: 1,
  evidence_expires_at: '2026-08-13T00:15:00.000Z',
  evidence_expired: false,
  attempts: [
    {
      attempt_number: 1,
      state: 'claimed',
      outcome: null,
      reason_code: 'SIMULATION_CLAIMED',
      report: null,
      expires_at: null,
      created_at: DATE,
    },
    {
      attempt_number: 1,
      state: 'blocked',
      outcome: 'blocked',
      reason_code: 'SIMULATION_QUOTE_TOKEN_CODE_MISSING',
      report: {
        schema: 'bl-sniping-simulation-report-v1',
        evidence_class: 'SIMULATED',
        kind: 'exact',
        identity: {
          config_id: '1',
          config_revision: 1,
          component_id: 'flap-quote-token-snipe',
          component_version: '1.0.0',
          schema_hash: HASH,
          chain: 'bsc',
          event: {
            chain: 'bsc',
            chain_id: 56,
            portal_address: ADDRESS,
            block_number: '10',
            block_hash: EVM_HASH,
            transaction_hash: EVM_HASH,
            log_index: 0,
            event_topic: EVM_HASH,
          },
          sender_address: ADDRESS,
          simulator_build_version: '1.0.0',
          config_fingerprint: HASH,
          build_fingerprint: HASH,
          protocol_fingerprint: HASH,
          call_policy_hash: HASH,
          request_fingerprint: HASH,
        },
        result: {
          outcome: 'blocked',
          reason_code: 'SIMULATION_QUOTE_TOKEN_CODE_MISSING',
          expected_output_atomic: null,
          minimum_output_atomic: null,
          estimated_gas: null,
          balance_ready: null,
          allowance_ready: null,
          virtual_gross_atomic: null,
          virtual_net_atomic: null,
        },
        checkpoint_count: 0,
        product_evidence: {
          schema: 'bl-sniping-flap-product-evidence-v1',
          scope: 'entry',
          token_address: ADDRESS,
          quote_token_address: ADDRESS,
          spend_amount_decimal: '1.25',
          declared_quote_token_decimals: 2,
          spend_amount_atomic: '125',
          quote_token_code_ready: false,
          quote_token_decimals_ready: null,
          quote_balance_atomic: null,
          balance_ready: null,
          allowance_atomic: null,
          allowance_ready: null,
          native_balance_wei: null,
          gas_cost_ready: null,
          estimated_gas_units: null,
          max_gas_units: '500000',
          gas_units_ready: null,
          portal_state_ready: null,
          quoted_output_atomic: null,
          minimum_output_atomic: null,
          simulated_output_atomic: null,
          permit_policy: 'empty-bytes-v1',
          quote_unit: 'quote-token-atomic',
          gas_unit: 'native-wei',
          cohort_counts: null,
        },
      },
      expires_at: '2026-08-13T00:15:00.000Z',
      created_at: '2026-08-13T00:00:01.000Z',
    },
  ],
  created_at: DATE,
  updated_at: DATE,
});

const shadowFixture = (): Record<string, any> => {
  const fixture: Record<string, any> = structuredClone(exactFixture());
  fixture.request_id = 'shadow-1';
  fixture.kind = 'shadow';
  fixture.canonical_event_key = null;
  fixture.shadow_policy = {
    max_events: 1,
    checkpoint_blocks: [1],
    evidence_ttl_seconds: 60,
  };
  fixture.position_count = 1;
  fixture.positions = [{
    canonical_event_key: EVENT_KEY,
    block_number: '10',
    block_hash: EVM_HASH,
    transaction_hash: EVM_HASH,
    log_index: 0,
    outcome: 'unknown',
    reason_code: 'SIMULATION_HISTORICAL_STATE_UNKNOWN',
    first_action_block_number: null,
    observation_to_action_ms: null,
    expected_output_atomic: null,
    minimum_output_atomic: null,
    virtual_gross_atomic: null,
    virtual_net_atomic: null,
    request_fingerprint: HASH,
    checkpoints: [{
      block_number: '11',
      block_hash: EVM_HASH,
      outcome: 'unknown',
      reason_code: 'SIMULATION_HISTORICAL_STATE_UNKNOWN',
      expected_output_atomic: null,
      minimum_output_atomic: null,
      virtual_gross_atomic: null,
      virtual_net_atomic: null,
    }],
    created_at: DATE,
  }];
  const attempt = fixture.attempts.at(-1);
  attempt.state = 'blocked';
  attempt.outcome = 'unknown';
  attempt.reason_code = 'SIMULATION_HISTORICAL_STATE_UNKNOWN';
  attempt.report.kind = 'shadow';
  attempt.report.identity.event = null;
  attempt.report.result.outcome = 'unknown';
  attempt.report.result.reason_code = 'SIMULATION_HISTORICAL_STATE_UNKNOWN';
  attempt.report.checkpoint_count = 1;
  attempt.report.product_evidence.scope = 'shadow';
  attempt.report.product_evidence.token_address = null;
  attempt.report.product_evidence.cohort_counts = {
    hit: 1, executable: 0, blocked: 0, unknown: 1, duplicate: 0,
  };
  return fixture;
};

test('real Flap evidence code-ready fields remain visible through the sanitized projection parser', () => {
  const parsed = parseSnipingSimulationRequestResponse(exactFixture());
  assert.deepEqual(parsed.attempts.map((attempt) => attempt.state), ['claimed', 'blocked']);
  assert.equal(parsed.attempts[1].report?.product_evidence?.schema, 'bl-sniping-flap-product-evidence-v1');
  assert.equal(parsed.attempts[1].report?.product_evidence?.quote_token_code_ready, false);
  assert.deepEqual(parsed.attempts[1].report?.identity.event, exactFixture().attempts[1].report.identity.event);
  assert.equal(acceptedSnipingReport(parsed), parsed.attempts[1].report);
});

test('simulation response cross-field provenance and accepted evidence fail closed', () => {
  const mutations: Array<(fixture: ReturnType<typeof exactFixture>) => void> = [
    (fixture) => { fixture.kind = 'shadow' as 'exact'; },
    (fixture) => { fixture.attempt_count = 2; },
    (fixture) => { fixture.accepted_attempt_number = 2; },
    (fixture) => { fixture.attempts[1].report.identity.config_revision = 2; },
    (fixture) => { fixture.attempts[1].report.kind = 'shadow'; },
    (fixture) => { fixture.attempts[1].report.product_evidence.scope = 'shadow'; },
    (fixture) => {
      delete (fixture.attempts[1].report.product_evidence as Record<string, unknown>).max_gas_units;
    },
  ];
  for (const mutate of mutations) {
    const fixture = exactFixture();
    mutate(fixture);
    assert.throws(() => parseSnipingSimulationRequestResponse(fixture), SnipingResponseError);
  }
});

test('simulation evidence requires strict pinned release and build SemVer', () => {
  for (const version of ['1.0.0-01', '1.0.0-..', '1.0.0-alpha..1', '1.0.0+']) {
    const release = exactFixture();
    release.attempts[1].report.identity.component_version = version;
    assert.throws(() => parseSnipingSimulationRequestResponse(release), SnipingResponseError);
    const build = exactFixture();
    build.attempts[1].report.identity.simulator_build_version = version;
    assert.throws(() => parseSnipingSimulationRequestResponse(build), SnipingResponseError);
  }
});

const nullTransition = (
  attemptNumber: number,
  state: 'claimed' | 'retryable' | 'expired' | 'failed',
): Record<string, unknown> => ({
  attempt_number: attemptNumber,
  state,
  outcome: null,
  reason_code: state === 'claimed'
    ? 'SIMULATION_CLAIMED'
    : state === 'expired' ? 'SIMULATION_CLAIM_EXPIRED' : `SIMULATION_${state.toUpperCase()}`,
  report: null,
  expires_at: null,
  created_at: DATE,
});

test('transition ledger accepts bounded retries and one standalone pre-claim failure', () => {
  const exhausted = exactFixture();
  Object.assign(exhausted, {
    state: 'failed',
    attempt_count: 3,
    accepted_attempt_number: null,
    evidence_expires_at: null,
    attempts: [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'expired'),
      nullTransition(3, 'claimed'), nullTransition(3, 'failed'),
    ],
  });
  assert.equal(parseSnipingSimulationRequestResponse(exhausted).attempts.length, 6);

  const preClaimFailure = structuredClone(exhausted);
  preClaimFailure.attempt_count = 1;
  preClaimFailure.attempts = [nullTransition(1, 'failed')];
  assert.deepEqual(
    parseSnipingSimulationRequestResponse(preClaimFailure).attempts.map((attempt) => attempt.state),
    ['failed'],
  );
});

test('request state follows the latest real Private transition lifecycle', () => {
  const fixture = (
    state: 'pending' | 'claimed' | 'failed',
    attemptCount: number,
    attempts: Record<string, unknown>[],
  ): Record<string, any> => ({
    ...exactFixture(),
    state,
    attempt_count: attemptCount,
    accepted_attempt_number: null,
    evidence_expires_at: null,
    attempts,
  });
  const valid = [
    fixture('pending', 0, []),
    fixture('claimed', 1, [nullTransition(1, 'claimed')]),
    fixture('pending', 1, [nullTransition(1, 'claimed'), nullTransition(1, 'retryable')]),
    fixture('pending', 2, [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'expired'),
    ]),
    fixture('failed', 3, [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'retryable'),
      nullTransition(3, 'claimed'), nullTransition(3, 'expired'),
    ]),
  ];
  for (const projection of valid) {
    assert.equal(parseSnipingSimulationRequestResponse(projection).state, projection.state);
  }

  const invalid: Array<[string, Record<string, any>]> = [
    ['advance after claimed then failed', fixture('claimed', 2, [
      nullTransition(1, 'claimed'), nullTransition(1, 'failed'),
      nullTransition(2, 'claimed'),
    ])],
    ['advance after standalone failed', fixture(
      'claimed', 2, [nullTransition(1, 'failed'), nullTransition(2, 'claimed')],
    )],
    ['third retryable remains pending', fixture('pending', 3, [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'retryable'),
      nullTransition(3, 'claimed'), nullTransition(3, 'retryable'),
    ])],
    ['third expired remains pending', fixture('pending', 3, [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'retryable'),
      nullTransition(3, 'claimed'), nullTransition(3, 'expired'),
    ])],
    ['second expired is failed early', fixture('failed', 2, [
      nullTransition(1, 'claimed'), nullTransition(1, 'retryable'),
      nullTransition(2, 'claimed'), nullTransition(2, 'expired'),
    ])],
  ];
  for (const [label, projection] of invalid) {
    assert.throws(
      () => parseSnipingSimulationRequestResponse(projection),
      SnipingResponseError,
      label,
    );
  }
});

test('only completed evidence owns the exact accepted terminal expiry', () => {
  const invalid: Array<[string, (fixture: Record<string, any>) => void]> = [
    ['completed request evidence missing', (fixture) => { fixture.evidence_expires_at = null; }],
    ['accepted terminal expiry missing', (fixture) => { fixture.attempts[1].expires_at = null; }],
    ['accepted terminal expiry differs', (fixture) => {
      fixture.attempts[1].expires_at = '2026-08-13T00:16:00.000Z';
    }],
    ['claimed transition exposes expiry', (fixture) => {
      fixture.attempts[0].expires_at = '2026-08-13T00:15:00.000Z';
    }],
    ['noncompleted request exposes evidence expiry', (fixture) => {
      Object.assign(fixture, {
        state: 'claimed', accepted_attempt_number: null,
        attempts: [nullTransition(1, 'claimed')],
      });
    }],
    ['noncompleted request claims expired evidence', (fixture) => {
      Object.assign(fixture, {
        state: 'claimed', accepted_attempt_number: null, evidence_expires_at: null,
        evidence_expired: true, attempts: [nullTransition(1, 'claimed')],
      });
    }],
  ];
  for (const [label, mutate] of invalid) {
    const fixture = exactFixture();
    mutate(fixture);
    assert.throws(
      () => parseSnipingSimulationRequestResponse(fixture),
      SnipingResponseError,
      label,
    );
  }
});

test('immutable claimed and expired transitions keep their fixed reasons', () => {
  const wrongClaimed = exactFixture();
  wrongClaimed.attempts[0].reason_code = 'SIMULATION_OTHER';
  assert.throws(() => parseSnipingSimulationRequestResponse(wrongClaimed), SnipingResponseError);

  const wrongExpired = {
    ...exactFixture(),
    state: 'pending',
    accepted_attempt_number: null,
    evidence_expires_at: null,
    attempts: [
      nullTransition(1, 'claimed'),
      { ...nullTransition(1, 'expired'), reason_code: 'SIMULATION_OTHER' },
    ],
  };
  assert.throws(() => parseSnipingSimulationRequestResponse(wrongExpired), SnipingResponseError);
});

test('transition ledger created_at order never moves backwards', () => {
  const fixture = exactFixture();
  fixture.attempts[0].created_at = '2026-08-13T00:00:02.000Z';
  fixture.attempts[1].created_at = '2026-08-13T00:00:01.000Z';
  assert.throws(() => parseSnipingSimulationRequestResponse(fixture), SnipingResponseError);
});

test('transition ledger rejects gaps, reversed or duplicate states, and multiple terminals', () => {
  const invalidLedgers: Array<[string, (fixture: Record<string, any>) => void]> = [
    ['descending attempt number', (fixture) => {
      fixture.state = 'failed';
      fixture.attempt_count = 2;
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(2, 'failed'), nullTransition(1, 'failed')];
    }],
    ['attempt number above count', (fixture) => {
      fixture.state = 'failed';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(2, 'failed')];
    }],
    ['attempt number gap', (fixture) => {
      fixture.state = 'failed';
      fixture.attempt_count = 3;
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(1, 'failed'), nullTransition(3, 'failed')];
    }],
    ['duplicate state', (fixture) => { fixture.attempts.splice(1, 0, nullTransition(1, 'claimed')); }],
    ['terminal before claimed', (fixture) => { fixture.attempts.reverse(); }],
    ['two terminal transitions', (fixture) => {
      fixture.state = 'pending';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [
        nullTransition(1, 'claimed'), nullTransition(1, 'retryable'), nullTransition(1, 'expired'),
      ];
    }],
    ['standalone retryable', (fixture) => {
      fixture.state = 'pending';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(1, 'retryable')];
    }],
    ['more than six rows', (fixture) => {
      fixture.state = 'failed';
      fixture.attempt_count = 3;
      fixture.accepted_attempt_number = null;
      fixture.attempts = Array.from({ length: 7 }, () => nullTransition(1, 'failed'));
    }],
  ];
  for (const [label, mutate] of invalidLedgers) {
    const fixture = exactFixture();
    mutate(fixture);
    assert.throws(() => parseSnipingSimulationRequestResponse(fixture), SnipingResponseError, label);
  }
});

test('attempt state semantics and accepted terminal report stay closed', () => {
  const executable = exactFixture();
  executable.attempts[1].state = 'succeeded';
  executable.attempts[1].outcome = 'executable';
  executable.attempts[1].reason_code = 'SIMULATION_EXECUTABLE';
  executable.attempts[1].report.result.outcome = 'executable';
  executable.attempts[1].report.result.reason_code = 'SIMULATION_EXECUTABLE';
  assert.equal(parseSnipingSimulationRequestResponse(executable).attempts[1].state, 'succeeded');

  const invalidRows: Array<[string, (fixture: Record<string, any>) => void]> = [
    ['claimed outcome', (fixture) => { fixture.attempts[0].outcome = 'blocked'; }],
    ['claimed report', (fixture) => { fixture.attempts[0].report = fixture.attempts[1].report; }],
    ['retryable outcome', (fixture) => {
      fixture.state = 'pending';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(1, 'claimed'), {
        ...nullTransition(1, 'retryable'), outcome: 'unknown',
      }];
    }],
    ['expired report', (fixture) => {
      fixture.state = 'pending';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [nullTransition(1, 'claimed'), {
        ...nullTransition(1, 'expired'), report: fixture.attempts[1].report,
      }];
    }],
    ['failed outcome', (fixture) => {
      fixture.state = 'failed';
      fixture.accepted_attempt_number = null;
      fixture.attempts = [{ ...nullTransition(1, 'failed'), outcome: 'blocked' }];
    }],
    ['blocked outcome', (fixture) => {
      fixture.attempts[1].outcome = 'executable';
      fixture.attempts[1].report.result.outcome = 'executable';
    }],
    ['blocked report missing', (fixture) => { fixture.attempts[1].report = null; }],
    ['succeeded outcome', (fixture) => {
      fixture.attempts[1].state = 'succeeded';
      fixture.attempts[1].outcome = 'unknown';
      fixture.attempts[1].report.result.outcome = 'unknown';
    }],
    ['completed without accepted attempt', (fixture) => { fixture.accepted_attempt_number = null; }],
    ['pending with accepted attempt', (fixture) => { fixture.state = 'pending'; }],
    ['claimed with accepted attempt', (fixture) => { fixture.state = 'claimed'; }],
    ['failed with accepted attempt', (fixture) => { fixture.state = 'failed'; }],
    ['accepted attempt without report', (fixture) => { fixture.attempts[1].report = null; }],
    ['two report terminals', (fixture) => {
      fixture.attempt_count = 2;
      const secondReport = structuredClone(fixture.attempts[1]);
      secondReport.attempt_number = 2;
      fixture.attempts.push(nullTransition(2, 'claimed'), secondReport);
    }],
  ];
  for (const [label, mutate] of invalidRows) {
    const fixture = exactFixture();
    mutate(fixture);
    assert.throws(() => parseSnipingSimulationRequestResponse(fixture), SnipingResponseError, label);
  }
});

test('Shadow projection preserves unknown nullable metrics and pinned position provenance', () => {
  const parsed = parseSnipingSimulationRequestResponse(shadowFixture());
  assert.equal(parsed.kind, 'shadow');
  assert.equal(parsed.canonical_event_key, null);
  assert.deepEqual(parsed.shadow_policy, {
    max_events: 1, checkpoint_blocks: [1], evidence_ttl_seconds: 60,
  });
  assert.equal(parsed.attempts[1].report?.result.outcome, 'unknown');
  assert.equal(parsed.attempts[1].report?.product_evidence?.scope, 'shadow');
  assert.equal(parsed.positions?.[0].virtual_gross_atomic, null);
  assert.equal(parsed.positions?.[0].virtual_net_atomic, null);
  assert.equal(parsed.positions?.[0].request_fingerprint, HASH);
  assert.equal(parsed.positions?.[0].checkpoints.length, 1);
});

test('Shadow cross-field identity, policy order and position fingerprints fail closed', () => {
  const mutations: Array<[string, (fixture: Record<string, any>) => void]> = [
    ['canonical event', (fixture) => { fixture.canonical_event_key = EVENT_KEY; }],
    ['position count', (fixture) => { fixture.position_count = 2; }],
    ['position fingerprint', (fixture) => { fixture.positions[0].request_fingerprint = 'b'.repeat(64); }],
    ['checkpoint block', (fixture) => { fixture.positions[0].checkpoints[0].block_number = '10'; }],
    ['shadow event', (fixture) => {
      fixture.attempts[1].report.identity.event = exactFixture().attempts[1].report.identity.event;
    }],
    ['evidence scope', (fixture) => { fixture.attempts[1].report.product_evidence.scope = 'entry'; }],
    ['checkpoint order', (fixture) => { fixture.shadow_policy.checkpoint_blocks = [2, 1]; }],
    ['checkpoint uniqueness', (fixture) => { fixture.shadow_policy.checkpoint_blocks = [1, 1]; }],
    ['checkpoint empty', (fixture) => { fixture.shadow_policy.checkpoint_blocks = []; }],
    ['checkpoint overflow', (fixture) => {
      fixture.shadow_policy.checkpoint_blocks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    }],
  ];
  for (const [label, mutate] of mutations) {
    const fixture = shadowFixture();
    mutate(fixture);
    assert.throws(() => parseSnipingSimulationRequestResponse(fixture), SnipingResponseError, label);
  }
});

test('pending Shadow response keeps exact zero count and empty positions', () => {
  const pending = shadowFixture();
  pending.state = 'pending';
  pending.attempt_count = 0;
  pending.accepted_attempt_number = null;
  pending.evidence_expires_at = null;
  pending.evidence_expired = false;
  pending.attempts = [];
  pending.positions = [];
  pending.position_count = 0;
  const parsed = parseSnipingSimulationRequestResponse(pending);
  assert.equal(parsed.state, 'pending');
  assert.equal(parsed.position_count, 0);
  assert.deepEqual(parsed.positions, []);

  delete pending.position_count;
  assert.throws(() => parseSnipingSimulationRequestResponse(pending), SnipingResponseError);
});

test('Shadow positions are unique while duplicate cohort evidence remains independent', () => {
  const withDuplicateCohort = shadowFixture();
  withDuplicateCohort.attempts[1].report.product_evidence.cohort_counts.duplicate = 7;
  const parsed = parseSnipingSimulationRequestResponse(withDuplicateCohort);
  assert.deepEqual(parsed.attempts[1].report?.product_evidence?.cohort_counts, {
    hit: 1, executable: 0, blocked: 0, unknown: 1, duplicate: 7,
  });
  assert.equal(parsed.positions?.length, 1);

  const duplicatePosition = shadowFixture();
  duplicatePosition.positions.push(structuredClone(duplicatePosition.positions[0]));
  duplicatePosition.position_count = 2;
  duplicatePosition.attempts[1].report.product_evidence.cohort_counts.hit = 2;
  duplicatePosition.attempts[1].report.product_evidence.cohort_counts.unknown = 2;
  assert.throws(
    () => parseSnipingSimulationRequestResponse(duplicatePosition),
    SnipingResponseError,
  );
});

test('response projections still fail closed on credential, RPC, calldata, and source surfaces', () => {
  for (const field of ['credentialRef', 'rpcUrl', 'calldata', 'handlerSource']) {
    const fixture = exactFixture();
    Object.assign(fixture.attempts[1].report.product_evidence, { [field]: 'redacted' });
    assert.throws(
      () => parseSnipingSimulationRequestResponse(fixture),
      (error) => error instanceof SnipingResponseError,
      field,
    );
  }
});
