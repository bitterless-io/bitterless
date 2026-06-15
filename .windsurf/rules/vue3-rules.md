---
trigger: always_on
description:
globs:
---

## State Management

- Do NOT use Pinia for business state management.
- Business components use `*.store.ts` files:
  1. Declare a class with `State` suffix (e.g. `ProductEditorState`).
  2. Use `reactive` to wrap the class instance, export a singleton with `store` suffix.
  3. All business logic (API calls, data transforms) lives in the store class.
  4. `.vue` files only handle UI rendering and data binding.

  ```ts
  import { reactive } from "vue";

  class ExampleState {
    loading = false;
    list: any[] = [];

    async fetchList() {
      this.loading = true;
      // API call ...
      this.loading = false;
    }
  }

  export const exampleStore = reactive<ExampleState>(new ExampleState());
  ```

## Function Rules
- When a function has more than 2 parameters, wrap the extra parameters into an `options` or `params` object and pass it as the second argument. For example:
  - Bad: `const fetchData = (id: string, page: number, pageSize: number, filter: string) => { ... }`
  - Good: `const fetchData = (id: string, options: { page: number; pageSize: number; filter: string }) => { ... }`

## Route Rules
- All routes must be declared in `src/router/defaultRoutes.ts` under the appropriate module section.

## View and Component Rules
- New pages must be developed under the appropriate module directory in `src/views/`.
- Page and component file names must use PascalCase, e.g. `UserList.vue`. Never use `index.vue` as a page or component name.
- When creating a `.vue` file, always create a corresponding `.less` file with the same name, e.g. `ComponentName.vue` + `ComponentName.less`.
- The structure order inside a `.vue` file must be: `<template>`, `<script>`, `<style>`. The `<style>` block should simply import the corresponding `.less` file (e.g. `@import './ComponentName.less';`).
- A page's `.vue` file and its corresponding `.less` file should be placed together in a dedicated folder under the appropriate `src/views/` module directory, to avoid having too many files directly in `src/views/**` which makes browsing difficult.
- The outermost `<div>` of every page should use the `full-container` class (defined in `common.less`) as the default container style.
- **Emit events should be used in generic custom components only.** Avoid using `emit` in business components; instead, use store state machine properties and functions to improve maintainability of business pages and components.

## Input Restriction

- Use `computed` with custom `set` accessor to enforce input rules.

  ```ts
  const amountInput = computed({
    get: () => formData.value.amount,
    set: (value: string) => {
      // filter and format
      formData.value.amount = filtered;
    },
  });
  ```

## Loading State

- Use `<a-spin>` component to wrap content and bind `loading` state.

  ```vue
  <a-spin :loading="store.loading">
    <!-- content -->
  </a-spin>
  ```

## General UI

- All components should use `size="mini"` by default.

## Modal (`a-modal`)

- Must support closing via the close icon (do not set `:closable="false"`).
- Footer must contain at least one "关闭" or "取消" button that closes the modal.

## CSS rules

- Use Less (`.less`) for component styles.
- Prefer editing styles in `.less` files rather than inline styles or `<style>` blocks in `.vue` files.

### Class Naming (BEM)
- Use BEM naming convention for CSS classes.
- When block nesting exceeds 3 levels, keep only the last 3 levels. For example, `a-block__b-block__c-block__d-block__alpha-element` should be shortened to `b-block__c-block__d-block__alpha-element`.
- **Do NOT use `&` nesting selectors.** Write all selectors flat. For example, use `.user-card__avatar` instead of `.user-card { &__avatar {} }`.

### Color Usage
- Use `oklch()` for colors. Refer to Tailwind CSS color palette oklch values as a design reference when choosing colors.\

## i18n rules
- All user-facing text in components must use i18n translations. Never hardcode display text directly in templates.
- Before adding text to a component, first add the translation keys and values for **all languages** (`en.ts`, `zh.ts`) in `src/renderer/common/i18n/`.
- Translations are organized by **business module** (e.g. `chat`, `setting`). Place new keys under the first matching module where the text logically belongs. Common modules include `chat`, `setting`, etc.
- **Always use `i18nHelper` for translations — never use `$t()` or `useI18n()`.** Import `i18nHelper` from `@renderer/common/i18n/i18n.helper` and access keys directly as properties, e.g. `i18nHelper.setting.llm.save`. This applies in both templates and `<script setup>`.

## Performance Optimization Rules
- For throttle and debounce functionality, always use `useThrottleFn` and `useDebounceFn` from `@vueuse/core`. Never use lodash or custom implementations.
- Example: `const throttledFn = useThrottleFn(() => { ... }, 1000);`
- Example: `const debouncedFn = useDebounceFn(() => { ... }, 300);`
