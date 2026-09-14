<script setup lang="ts">
/**
 * OnlyPreview 的标记 —— **单色版**,给画在品牌色上的表面用(菜单条就是 `--onlypreview-royal`)。
 *
 * 和 tab chip 上那个图标是**同一个形**(方框 ＋ 居中的眼睛),只是换了一种画法:
 *   · chip 在浅色 tab 条上,需要一块实心底才像一个应用图标 → 实心版,取值在 registry 的 favicon;
 *   · 菜单条本身就是 `#4e5882`,实心底会和背景糊在一起 → 这一版走描边 ＋ `currentColor`,
 *     于是它和它旁边的字用同一个颜色变量(`.onlypreview-shell__identity-icon` 的 `#f6f7fc`)。
 *
 * 它替掉的是 tabler 的 `IconFiles` —— 一个通用的「文件」字形,谁都能用,因此什么也没说。
 * 空状态那处的 `IconFiles` **刻意保留**:那里要的正是「文件」这个通用意思,不是产品标记。
 *
 * 接口对齐 tabler:`size` 同时给宽高,颜色由 CSS `color` 继承 —— 调用点因此一个字都不用改。
 */
withDefaults(defineProps<{ size?: number | string }>(), { size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x=".95" y=".95" width="14.1" height="14.1" rx="3.1" />
    <path d="M3.6 8C5 5.75 6.4 4.65 8 4.65s3 1.1 4.4 3.35c-1.4 2.25-2.8 3.35-4.4 3.35S5 10.25 3.6 8Z" />
    <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
  </svg>
</template>
