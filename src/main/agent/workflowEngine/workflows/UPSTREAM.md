# Built-in workflow provenance

The advisory and research contracts, research evidence sanitizers, safe review-diff parser, lens descriptions and workflow prompt intent are derived from `pi-workflow-engine` 0.12.0 (`.pi/extensions/pi-workflow-engine`). The upstream MIT license is retained as `LICENSE` in this directory.

This release replaces the old engine and author API with the public `@kimchi-dev/kimchi-workflows/flow` and `/engine` exports, pinned to 0.0.9. No old engine/session/runner code executes.

Local changes:

- `createAgentTask` provides explicit completed/stopped/failed outcomes, isolated Pi sessions and cleanup-confirmed timeout/retry behavior.
- Four advisory workflows retain distinct scope contracts, lenses, independent candidate verification, evidence and report shapes. Their shared graph uses a finder barrier, bounded deduplication, independent verification foreach, synthesis, and explicit partial results.
- Code review captures one allowlisted Git/PR diff in the engine utility process; candidate locations must be in its changed lines. Synthesis cannot invent evidence. Patch-preview snapshot metadata and upstream UI lane rendering are not carried over.
- Research retains its original plan/gather/independent-verify/synthesize contracts and citation/claim sanitation. Tools are the host's cancellable web_search/web_fetch.
- mini-demo accepts the input requirement, runs three no-tool Pi Agents in parallel, then a separate summary Agent. Missing branches remain explicit.

Workflow text and helper modules are executable trusted local code, not a sandbox. No CLI, background service, automatic Git branch/worktree operation or crash-resume is used.
