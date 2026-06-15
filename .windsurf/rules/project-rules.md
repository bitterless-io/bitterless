---
trigger: always_on
---

**this is electron and nodejs project.**

## Platform Support
- Supported platforms: **macOS** and **Windows**
- Linux is NOT supported

## style rules
- use `src/renderer/common/assets/style/theme.less` as default style
- default vertical and horizontal spacing (gap) is **12px**
- default padding is **8px**
- all top-level landing pages  must use the `bl-full-container` class from `theme.less` as the outermost container

### Theme Color Palette
Use the following Royal Blue color palette for theme colors:

```less
@theme {
  --color-royalblue-50: oklch(0.97 0.01 274);
  --color-royalblue-100: oklch(0.92 0.01 274);
  --color-royalblue-200: oklch(0.84 0.03 274);
  --color-royalblue-300: oklch(0.74 0.04 274);
  --color-royalblue-400: oklch(0.64 0.06 274);
  --color-royalblue-500: oklch(0.54 0.08 274);
  --color-royalblue-600: oklch(0.47 0.07 274);
  --color-royalblue-700: oklch(0.4 0.06 274);
  --color-royalblue-800: oklch(0.35 0.05 274);
  --color-royalblue-900: oklch(0.26 0.04 274);
  --color-royalblue-950: oklch(0.19 0.03 274);
}
```


## Requirement Clarification Rules

- When the user's described requirement may be incomplete, ambiguous, or potentially conflict with existing business logic, **do not proceed with implementation immediately**.
- First, review the existing codebase and business flow to identify gaps or inconsistencies.
- Ask the user targeted clarifying questions about any parts that are unclear or missing before writing code.


## code documentation


### main interface
- `/src/renderer/home/src/App.vue` is the main interface of the application


