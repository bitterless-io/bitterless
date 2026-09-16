import { Type } from 'typebox'
import { makeAdvisoryWorkflow, type Lens } from './advisory'
const ScopeSchema = Type.Object({
  target: Type.String({ description: "Verbatim slow path, workload, command, or performance concern." }),
  files: Type.Array(Type.String(), { description: "Repository-relative files likely involved in the performance path." }),
  commands: Type.Array(Type.String(), { description: "Existing benchmark, smoke, or measurement commands relevant to this path." }),
  summary: Type.String({ description: "One-paragraph summary of the performance-relevant path." }),
  knownMeasurements: Type.Optional(Type.String({ description: "Existing measurements, timings, or explicit lack of measurements." })),
});
const PERF_LENSES: Lens[] = [
  { label: "algorithmic", category: "algorithmic", text: "Complexity, repeated scans, avoidable nested loops, or data-structure choices that grow poorly with input size." },
  { label: "io", category: "io", text: "Filesystem, subprocess, network, or other I/O costs on hot paths or startup paths." },
  { label: "concurrency", category: "concurrency", text: "Unnecessary serialization, missing batching, excessive fan-out, contention, or concurrency limits." },
  { label: "startup", category: "startup", text: "Import/module loading, initialization, discovery, or cold-start overhead." },
  { label: "allocation", category: "allocation", text: "Memory churn, large intermediate strings/objects, repeated serialization, or retained state growth." },
  { label: "measurement", category: "measurement", text: "Missing, misleading, noisy, or insufficient benchmark/measurement design." },
];
export default makeAdvisoryWorkflow({
 name: 'perf-review', description: "Establish the scope for an advisory-only performance review. Inspect scripts, likely hot paths and benchmark commands. Prefer identifying what to measure before claiming bottlenecks. Return files, commands, summary and actual known measurements or their absence.", scopeSchema: ScopeSchema, lenses: PERF_LENSES, perLens: 4,
 scopePrompt: "Establish the scope for an advisory-only performance review. Inspect scripts, likely hot paths and benchmark commands. Prefer identifying what to measure before claiming bottlenecks. Return files, commands, summary and actual known measurements or their absence.",
 finderPrompt: "Identify bottleneck hypotheses, measurement gaps and safe optimization directions. State the workload where each matters. Prefer measurement recommendations when evidence is weak; do not claim performance wins from code shape alone.",
 verifierPrompt: "Read relevant files/scripts. Run safe read-only measurement commands when useful. Report actual workloads, timing/counts, output equivalence and limitations. Default toward PLAUSIBLE or REFUTED without measurements; never fabricate speedups.",
 synthesisPrompt: "Explain measured bottlenecks separately from suspected ones. Categories: algorithmic, io, concurrency, startup, allocation, measurement. Prefer measurement before optimization when evidence is weak; include risky optimizations to avoid."
})
