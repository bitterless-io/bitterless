import type { SnapshotGap } from '@maestro-main/capture/debuggerCapture'

/**
 * `/page_snapshot_compare` 的 `diagnosis.md`(契约 `docs/features/page-snapshot-compare.md`)。
 *
 * 归因已经在页面里算完了 —— 这里只负责排版。之所以单独成文件而不是塞进控制器:
 * 它是纯函数,测试不需要窗口、不需要 Electron。
 */
export const buildSnapshotDiagnosis = (input: {
  url: string
  title: string
  tabId: string
  nodeCount: number
  gaps: SnapshotGap[]
  benign: number
  meta: Record<string, unknown>
}): string => {
  const lines: string[] = []
  lines.push('# page_snapshot 覆盖诊断')
  lines.push('')
  lines.push(`- 页面：${input.url}`)
  lines.push(`- 标题：${input.title}`)
  lines.push(`- tab：${input.tabId}`)
  lines.push(`- 树里保留的元素：${input.nodeCount}`)
  lines.push(`- 抓取时刻：${String(input.meta?.capturedAt ?? '')}`)
  lines.push('')

  if (!input.gaps.length) {
    lines.push('## 结论：未发现盲区')
    lines.push('')
    lines.push('页面上每一处可见的文字叶子都在树里有对应节点。')
    if (input.benign) {
      lines.push('')
      lines.push(
        `另有 ${input.benign} 处文字按设计不进树（\`aria-hidden\` / \`[hidden]\` / 真隐藏）——这不是缺陷。`
      )
    }
    lines.push('')
    lines.push(coverageCaveat())
    return lines.join('\n')
  }

  const leaves = input.gaps.reduce((sum, gap) => sum + gap.leaves, 0)
  lines.push(`## 结论：树里漏了 ${leaves} 处页面上可见的文字，分布在 ${input.gaps.length} 个剪枝点`)
  lines.push('')
  for (const gap of input.gaps) {
    lines.push(`### ${gap.culprit}`)
    lines.push('')
    lines.push(`- 归因：${gap.reason}`)
    lines.push(`- 计算样式 display：\`${gap.display || 'unknown'}\`　getClientRects()：${gap.rects}`)
    lines.push(`- 吞掉的可见文字叶子：${gap.leaves}`)
    if (gap.sample.length) lines.push(`- 样本：${gap.sample.map((s) => JSON.stringify(s)).join(' · ')}`)
    lines.push('')
    lines.push('```html')
    lines.push(gap.outer)
    lines.push('```')
    lines.push('')
  }
  if (input.benign) {
    lines.push(
      `另有 ${input.benign} 处文字按设计不进树（\`aria-hidden\` / \`[hidden]\` / 真隐藏）——已排除，不计入上面。`
    )
    lines.push('')
  }
  lines.push('## 怎么用')
  lines.push('')
  lines.push('拿剪枝点的 class / id 去 `page.html` 里搜，就能看到它下面到底挂了什么。')
  lines.push('`snapshot.yml` 里的 `[ref=eN]` 在 `page.html` 里同样能搜到——两份是交叉可对照的。')
  lines.push('')
  lines.push(coverageCaveat())
  return lines.join('\n')
}

/**
 * 诊断器的可达范围和走树**相同**：主文档 + open shadow root + 同源 frame。
 * 说清这条,是因为"没报盲区"不等于"没有盲区" —— 把这句省掉,这份报告就变成了它要修的那种
 * 静默假阴性。
 */
const coverageCaveat = (): string =>
  [
    '---',
    '',
    '**覆盖范围**：本诊断能枚举的与走树相同 —— 主文档、open shadow root、同源 frame。',
    'closed shadow root 与跨源 iframe 里的内容它同样看不到，所以"未发现盲区"只代表',
    '"在可达范围内没有"。那两类由 `snapshot.yml` 里的 `-- content not readable` 标注',
    '和 `# INCOMPLETE` 文本覆盖自检从另一条路兜底。'
  ].join('\n')
