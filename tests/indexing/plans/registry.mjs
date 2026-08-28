/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { planA } from './planA.onlypreview.mjs';

const OPTIONAL_PLAN_MODULES = Object.freeze({
  B: './planB.scopedSqlite.mjs',
  C: './planC.tieredLazy.mjs',
  D: './planD.scanOnly.mjs'
});

const importOptionalPlan = async (specifier) => {
  try {
    const loaded = await import(specifier);
    return Object.values(loaded).find((value) => value?.id && value?.init);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
};

/** Plans B-D are optional so the CLI stays usable while they are being written. */
export const loadPlans = async () => {
  const plans = new Map([[planA.id, planA]]);
  for (const [id, specifier] of Object.entries(OPTIONAL_PLAN_MODULES)) {
    const plan = await importOptionalPlan(specifier);
    if (plan) plans.set(id, plan);
    else void id;
  }
  return plans;
};

export const resolvePlan = async (planId) => {
  const plans = await loadPlans();
  const plan = plans.get(String(planId ?? 'A').toUpperCase());
  if (!plan) {
    throw new TypeError(
      `Unknown plan ${planId}. Available: ${[...plans.keys()].join(', ')} (run "yarn indexing plans")`
    );
  }
  return plan;
};
