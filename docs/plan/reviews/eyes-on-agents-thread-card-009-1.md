# EyesOnAgents Thread Card Simplification Review — Round 1

Status: accepted

Date: 2026-07-20

## Conclusion

Pass. The thread card no longer renders the decorative signal rail/dot or source badge, and Open is
an icon-only action with localized tooltip, `title`, and `aria-label`. Existing thread status,
unread, metadata, Domain move, keyboard, double-click, loading, disabled, and open behaviors remain
present.

One stale source-badge sentence in the layout document was found during independent review and
removed before acceptance. Persisted source metadata was intentionally left unchanged.

## Verification

- Independent static source and diff review: pass.
- Renderer source guard updated to reject signal/source UI regressions and require the accessible
  icon-only Open contract.
- Tests, builds, formatting, and Electron launch were not run at the owner's request. The owner will
  perform the visual check.
