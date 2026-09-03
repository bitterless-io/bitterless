# CSP `*` Does Not Match the Preview Scheme

Status: fixed; owner verification pending

## Symptom

`yarn dev:prod`, previewing a PNG:

```text
Loading the image 'bitterless-preview://asset/***/6.png' violates the following Content Security
Policy directive: "img-src * data: blob:". Note that '*' matches only URLs with network schemes
('http', 'https', 'ws', 'wss'), or URLs whose scheme matches the page's own scheme.
```

## Root cause

A regression introduced while opening the preview CSP. The owner asked for the content-loading
directives to carry no restriction, and `img-src 'self' data: blob: bitterless-preview:` was
rewritten to `img-src * data: blob:` on the assumption that `*` is strictly wider.

It is not. CSP's `*` source expression matches only the network schemes and the page's own scheme;
a custom scheme is never covered by it and must be listed by name. The preview page is loaded from
`file://`, so `bitterless-preview:` matched nothing, and dropping the explicit scheme made the
policy *narrower* for exactly the one source that matters.

The same mistake was applied to `media-src`, `connect-src`, `font-src`, `object-src` and
`frame-src`, so audio, video and the media preflight were on the same path.

## Repair contract

- Every directive that loads preview content lists `bitterless-preview:` by name, alongside `*`,
  `data:` and `blob:`. `*` stays for the owner's "no restriction" requirement; the named scheme is
  what actually admits the asset.
- Applied to both `src/renderer/onlypreview/preview/index.html` and
  `src/renderer/onlypreview/shell/index.html`.
- `script-src` stays `'self'`, unchanged.
- The source guard now parses each directive's source list and asserts the scheme is named, rather
  than asserting the directive is `*`. The previous guard passed while the policy was broken.

Delivery: [onlypreview-image-read-diagnostics-115](../plan/tasks/onlypreview-image-read-diagnostics-115.md).
