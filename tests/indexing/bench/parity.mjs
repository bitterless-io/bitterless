/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { searchSignature } from '../plans/planContract.mjs';

const setDifference = (left, right) => left.filter((value) => !right.includes(value));

/**
 * Compares one plan's answer against the reference plan's. A truncated reference cannot be compared
 * for equality - two plans may legitimately return different members of an over-large match set - so
 * a truncated comparison only asserts containment.
 */
export const compareOutcome = ({ reference, candidate, section, truncated }) => {
  const referencePaths = searchSignature(reference)[section];
  const candidatePaths = searchSignature(candidate)[section];
  const missing = setDifference(referencePaths, candidatePaths);
  const extra = setDifference(candidatePaths, referencePaths);
  if (truncated) {
    return {
      section,
      status: extra.length === 0 ? 'subset' : 'extra',
      referenceCount: referencePaths.length,
      candidateCount: candidatePaths.length,
      extra: extra.slice(0, 5)
    };
  }
  if (missing.length === 0 && extra.length === 0) {
    return { section, status: 'equal', referenceCount: referencePaths.length };
  }
  return {
    section,
    status: 'mismatch',
    referenceCount: referencePaths.length,
    candidateCount: candidatePaths.length,
    missing: missing.slice(0, 5),
    extra: extra.slice(0, 5)
  };
};

/**
 * Plan A's Files section is project-wide by product decision, so for a directory scope its Files
 * answer is expected to differ from a plan that scopes names. That difference is declared here
 * instead of being reported as a defect.
 */
export const expectedFilesDivergence = ({ referencePlan, candidatePlan, scope }) =>
  scope.kind === 'directory' &&
  Boolean(scope.relativePath) &&
  referencePlan.capabilities.scopedFiles !== candidatePlan.capabilities.scopedFiles;

export const summarizeParity = (rows) => {
  const counts = { equal: 0, subset: 0, mismatch: 0, extra: 0, expected: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return {
    counts,
    ok: counts.mismatch === 0 && counts.extra === 0,
    mismatches: rows.filter((row) => row.status === 'mismatch' || row.status === 'extra')
  };
};
