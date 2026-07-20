# EyesOnAgents All And Wrapping Domain Board Review — Round 1

Status: accepted

Date: 2026-07-20

## Conclusion

Pass. All is a fixed clone-safe projection of every non-archived snapshot thread, and its Project
filter uses the complete visible inventory across stored Domain assignments. Focus and custom
Domain scopes, the internal `uncategorized` fallback, repository deletion transactions, and archive
visibility remain unchanged.

Custom Domain titles now use Todo-style click-to-edit behavior with measured 40–200px inputs;
Focus and All remain fixed. Rename was removed from the menu. The board uses one wrapping draggable
container, columns are capped at 600px with internal body scrolling, and the outer board owns
vertical scrolling across rows.

## Findings resolved during review

- A Project-filter state row initially claimed the filter remained mounted with zero visible
  threads. The application correctly shows its full-page empty state in that condition, and the
  document was corrected before acceptance.

## Verification

- Independent static source, contract, and diff review: pass with no P1/P2/P3 remaining.
- Renderer source guards cover All data scope, Project-filter scope, clone-only fixed projections,
  draggable indices, wrapping/scrolling/600px constraints, title editing, reserved All, and Rename
  removal.
- Tests, builds, formatting, and Electron launch were not run at the owner's request. The owner will
  perform visual, drag, and runtime verification.
