import { Type } from 'typebox'
import { makeAdvisoryWorkflow, type Lens } from './advisory'
const ScopeSchema = Type.Object({
  symptom: Type.String({ description: "Observed bug, failing command, regression, or unclear behavior." }),
  commands: Type.Array(Type.String(), { description: "Safe read-only or diagnostic commands relevant to the symptom." }),
  files: Type.Array(Type.String(), { description: "Repository-relative files likely involved." }),
  observations: Type.Array(Type.String(), { description: "Concrete observations from files, tests, config, or command output." }),
  constraints: Type.Optional(Type.String({ description: "Safety constraints, missing evidence, or commands intentionally not run." })),
});
const HYPOTHESIS_LENSES: Lens[] = [
  { label: "recent-change", category: "regression", text: "A recent code change broke a previously working path or changed an implicit contract." },
  { label: "control-flow", category: "root-cause", text: "Incorrect branching, ordering, async flow, data flow, or state transition causes the symptom." },
  { label: "configuration", category: "configuration", text: "Configuration, environment, package scripts, or runtime assumptions differ from what the code expects." },
  { label: "dependency-api", category: "dependency", text: "A dependency API, version, import mode, or bundled peer behavior does not match the implementation." },
  { label: "test-fixture", category: "test-fixture", text: "The failure is caused by test setup, fixtures, mocks, generated files, or stale local state rather than product code." },
];
export default makeAdvisoryWorkflow({
 name: 'diagnose', description: "Establish the scope for an advisory-only bug diagnosis. Inspect the symptom, relevant files, package/test config, and safe diagnostic commands. Record actual observations, relevant commands, files and constraints; distinguish observed failures from guesses.", scopeSchema: ScopeSchema, lenses: HYPOTHESIS_LENSES, perLens: 4,
 scopePrompt: "Establish the scope for an advisory-only bug diagnosis. Inspect the symptom, relevant files, package/test config, and safe diagnostic commands. Record actual observations, relevant commands, files and constraints; distinguish observed failures from guesses.",
 finderPrompt: "Propose competing root-cause hypotheses connecting code/configuration to the observed symptom. Include the smallest next validation command. Do not assume the test or the implementation is necessarily right.",
 verifierPrompt: "Independently test the hypothesis against observations. Read files and run only safe scoped diagnostic commands. Default toward REFUTED unless evidence connects this exact hypothesis to the symptom; explain competing explanations ruled out.",
 synthesisPrompt: "Rank confirmed root causes above plausible hypotheses. Separate evidence from guesses, describe the causal chain and smallest reproducible validation/fix plan. Do not patch the code."
})
