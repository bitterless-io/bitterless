import { Type } from 'typebox'
import { makeAdvisoryWorkflow, type Lens } from './advisory'
const ScopeSchema = Type.Object({
  target: Type.String({ description: "Verbatim target path, module, or focus area being scouted." }),
  files: Type.Array(Type.String(), { description: "Repository-relative files in scope." }),
  summary: Type.String({ description: "One-paragraph summary of the scoped code." }),
  conventions: Type.Optional(Type.String({ description: "Relevant project conventions from AGENTS.md / docs." })),
});
const REFACTOR_LENSES: Lens[] = [
  { label: "duplication", category: "duplication", text: "Repeated logic, copy-pasted structures, or near-duplicate flows that could share one clearer implementation." },
  { label: "complexity", category: "complexity", text: "Oversized functions, tangled control flow, or abstractions that make local reasoning harder than necessary." },
  { label: "type-safety", category: "type-safety", text: "Weak typing, avoidable casts, unchecked shapes, or places stronger types would prevent mistakes." },
  { label: "boundaries", category: "boundary", text: "Leaky module boundaries, misplaced responsibilities, or imports that couple unrelated layers." },
  { label: "dead-code", category: "dead-code", text: "Unused, obsolete, or redundant code paths that can likely be removed safely." },
  { label: "conventions", category: "conventions", text: "Departures from project conventions, naming, dependency rules, or local idioms." },
];
export default makeAdvisoryWorkflow({
 name: 'refactor-scout', description: "Establish the scope for an advisory-only refactor scout. Inspect the target module, repository structure, and relevant AGENTS.md/project conventions. Return concrete files, summary, and conventions. Keep recommendations small and defensible; no broad rewrites.", scopeSchema: ScopeSchema, lenses: REFACTOR_LENSES, perLens: 5,
 scopePrompt: "Establish the scope for an advisory-only refactor scout. Inspect the target module, repository structure, and relevant AGENTS.md/project conventions. Return concrete files, summary, and conventions. Keep recommendations small and defensible; no broad rewrites.",
 finderPrompt: "Find concrete duplication, complexity, weak typing, boundary leakage, dead code, and convention issues only through the assigned lens.",
 verifierPrompt: "Read relevant files and call sites. Verify the proposed simplification preserves existing behavior. Distinguish existing correctness bugs from a refactor opportunity. Default toward REFUTED when benefit or safety cannot be substantiated.",
 synthesisPrompt: "Recommend small safe refactors, preservation constraints and focused validation. Categories: duplication, complexity, type-safety, boundary, dead-code, conventions. Avoid speculative abstraction and broad rewrites."
})
