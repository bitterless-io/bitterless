# Delivery Backlog

Non-blocking review findings are recorded here after task verification.

- Localize the migrated Maestro renderer's existing English-only product copy after runtime parity is
  accepted. The Bitterless Mini App card is bilingual in the parity delivery.
- Design an explicit, offline migration tool for a closed standalone Cowork profile if preserving
  existing standalone sessions/history becomes a product requirement.
- Make the OnlyPreview native MenuBar hover check deterministic across synthetic pointer injection;
  the product hover state is correct, but one review run missed the injected `mouseMove` before
  succeeding on focused and full reruns.
- Add a lightweight bundled Shell-store behavior harness for OnlyPreview browse/search projection
  races. Current service behavior is covered with real fixtures, while renderer generation,
  refresh, selected-ancestor, and stale-listing guarantees are primarily source-pattern guards.
