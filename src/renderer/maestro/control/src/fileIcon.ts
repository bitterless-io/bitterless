import {
  IconFile,
  IconFileCode,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypeCsv,
  IconFileTypeDocx,
  IconFileTypeHtml,
  IconFileTypePdf,
  IconJson,
  IconMarkdown,
  IconPhoto
} from '@tabler/icons-vue'

// File-type icon (Tabler) for an attachment, by extension. Shared by the composer
// chips and the chat files message so the two never drift. Extensions without a
// specific Tabler icon fall back to the generic IconFile.
export const fileIcon = (name: string): typeof IconFile => {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return IconFileTypePdf
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') return IconFileSpreadsheet
  if (ext === 'csv' || ext === 'tsv') return IconFileTypeCsv
  if (ext === 'docx' || ext === 'doc') return IconFileTypeDocx
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return IconPhoto
  if (ext === 'md' || ext === 'markdown') return IconMarkdown
  if (ext === 'json') return IconJson
  if (ext === 'html' || ext === 'htm' || ext === 'xml') return IconFileTypeHtml
  if (['js', 'cjs', 'mjs', 'jsx', 'ts', 'tsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(ext)) return IconFileCode
  if (ext === 'txt' || ext === 'log') return IconFileText
  return IconFile
}
