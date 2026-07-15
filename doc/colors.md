# 颜色

> 历史颜色探索稿。当前设计规范以 [`docs/design/colors.md`](../docs/design/colors.md) 为准；
> 新增或修改主题色、菜单图标状态色时，不再直接更新本文件。

## 主题色
- 50:#f8f8f8
- #eceef5
- #d9ddec
- #c4cadf
- #afb6d2
- #9aa3c5
- #8188a2
- #676e87
- #555a6c
- #373a45
- #1e212b

```less
@theme {
  --color-lightslategray-50: oklch(0.98 0 273);
  --color-lightslategray-100: oklch(0.95 0.01 273);
  --color-lightslategray-200: oklch(0.9 0.02 273);
  --color-lightslategray-300: oklch(0.84 0.03 273);
  --color-lightslategray-400: oklch(0.78 0.04 273);
  --color-lightslategray-500: oklch(0.72 0.05 273);
  --color-lightslategray-600: oklch(0.63 0.04 273);
  --color-lightslategray-700: oklch(0.54 0.04 273);
  --color-lightslategray-800: oklch(0.47 0.03 273);
  --color-lightslategray-900: oklch(0.35 0.02 273);
  --color-lightslategray-950: oklch(0.25 0.02 273);
}
```

```
#f3f5fc
#e2e4eb
#c4cadf
#a3aac5
#808ab1
#606b9d
#4e5882
#3e4568
#323955
#1e2237
#101321
```



最后决定:
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
