import type { WorkflowAgentStatus } from '@shared/agentWorkflow.api'
export interface WorkflowUiMessages {
 commandHint: string; commandUsage: string; commandAttachments: string; commandUnknown: string; commandInput: string; commandWorkspace: string; commandStarted: string; commandBusy: string; demoInput: string;
 categories: Record<'active' | 'paused' | 'completed' | 'failed' | 'stopped', string>; partialFailure: string;
 pause: string; resume: string; tasks: string; count: string; current: string; stopAll: string; stoppingAll: string; stop: string; collapse: string; expand: string; empty: string; emptyHint: string; ended: string; logs: string; result: string; scroll: string; loadError: string; stopError: string; retry: string; rerun: string; retryError: string; retryUnavailable: string; loading: string; waiting: string; failures: string; complete: string; working: string; states: Record<WorkflowAgentStatus,string>
}
export const workflowEn: WorkflowUiMessages = {
 pause: 'Pause Agent', resume: 'Resume Agent', tasks: 'Tasks',
 categories: { paused: 'Paused', active: 'In progress', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' }, partialFailure: 'Finished with failed Agents',
 commandHint: "List workflows or run /workflow <name> <task>",
 commandUsage: "Use `/workflow demo` to try the demo, or `/workflow <name> <task>` to run a workflow. A quoted absolute .ts/.mts path also works.",
 commandAttachments: "Use file paths in the workflow task. Remove composer attachments before starting; they have not been sent.",
 commandUnknown: "Unknown workflow: {name}. Use /workflow to list available workflows.",
 commandInput: "Describe the task after the workflow name.",
 commandWorkspace: "Select a project workspace before starting a workflow.",
 commandStarted: "Started {name}. Follow its Agents, result, and Stop controls in the task bar.",
 commandBusy: "Wait for the current chat work to finish or stop it before starting another workflow.",
 demoInput: "Compare three practical ways to make a team task handoff clearer, then combine the findings into a concise recommendation.",
 count: '{count} tasks', current:'Current chat',stopAll:'Stop all',stoppingAll:'Stopping…',stop:'Stop Agent',collapse:'Collapse task list',expand:'Expand task list',empty:'No Agent tasks in this chat',emptyHint:'Tasks appear here when a workflow starts.',ended:'Finished',logs:'Work log',result:'Result',scroll:'Scroll to see more',loadError:'Could not load workflow tasks.',stopError:'Could not stop the selected work.',retry:'Retry',rerun:'Rerun entire workflow',retryError:'Could not restart the workflow.',retryUnavailable:'Start this older workflow again with /workflow.',loading:'Loading tasks…',waiting:'{count} waiting for confirmation',failures:'{count} failed',complete:'All tasks finished',working:'Agents are working',states:{pausing:'Pausing',paused:'Paused',queued:'Queued',running:'Running',waiting:'Waiting for tool',approval:'Waiting for you',retrying:'Retrying',stopping:'Stopping',completed:'Completed',failed:'Failed',stopped:'Stopped'}
}
export const workflowZh: WorkflowUiMessages = {
 pause: '暂停 Agent', resume: '继续 Agent', tasks: '任务',
 categories: { paused: '已暂停', active: '进行中', completed: '已完成', failed: '失败', stopped: '已停止' }, partialFailure: '已结束，含失败 Agent',
 commandHint: "查看 workflow，或用 /workflow <名称> <任务> 启动",
 commandUsage: "输入 `/workflow demo` 试跑示例，或 `/workflow <名称> <任务>` 启动。也支持加引号的 .ts/.mts 绝对路径。",
 commandAttachments: "请将文件路径写进 workflow 任务，并先移除输入框附件；这些附件尚未发送。",
 commandUnknown: "未知 workflow：{name}。输入 /workflow 查看可用列表。",
 commandInput: "请在 workflow 名称后写明任务。",
 commandWorkspace: "请先为当前会话选择项目工作目录。",
 commandStarted: "已启动 {name}。可在 taskbar 查看各 Agent、结果并单独停止。",
 commandBusy: "当前会话有工作正在进行，请等它结束或先停止，再启动 workflow。",
 demoInput: "分别从三个实用角度分析如何让团队任务交接更清楚，再合并为简短建议。",
 count:'{count} 个 task',current:'当前会话',stopAll:'全部停止',stoppingAll:'停止中…',stop:'停止 Agent',collapse:'收起 task 清单',expand:'展开 task 清单',empty:'当前会话还没有 Agent task',emptyHint:'运行 workflow 后，任务会显示在这里。',ended:'已结束',logs:'工作记录',result:'结果',scroll:'滚动查看更多',loadError:'无法加载 workflow 任务。',stopError:'未能停止所选任务。',retry:'重试',rerun:'重新运行整个 workflow',retryError:'未能重新运行 workflow。',retryUnavailable:'此旧记录请用 /workflow 重新启动。',loading:'正在加载任务…',waiting:'{count} 个等待你确认',failures:'{count} 个失败',complete:'任务已结束',working:'Agent 正在工作',states:{pausing:'暂停中',paused:'已暂停',queued:'排队中',running:'执行中',waiting:'等待工具',approval:'等待你确认',retrying:'重试中',stopping:'停止中',completed:'已完成',failed:'失败',stopped:'已停止'}
}
export const workflowZhTw: WorkflowUiMessages = {
 pause: '暫停 Agent', resume: '繼續 Agent', tasks: '任務',
 categories: { paused: '已暫停', active: '進行中', completed: '已完成', failed: '失敗', stopped: '已停止' }, partialFailure: '已結束，含失敗 Agent',
 commandHint: "查看 workflow，或用 /workflow <名稱> <任務> 啟動",
 commandUsage: "輸入 `/workflow demo` 試跑範例，或 `/workflow <名稱> <任務>` 啟動。也支援加引號的 .ts/.mts 絕對路徑。",
 commandAttachments: "請將檔案路徑寫進 workflow 任務，並先移除輸入框附件；這些附件尚未傳送。",
 commandUnknown: "未知 workflow：{name}。輸入 /workflow 查看可用清單。",
 commandInput: "請在 workflow 名稱後寫明任務。",
 commandWorkspace: "請先為目前會話選擇專案工作目錄。",
 commandStarted: "已啟動 {name}。可在 taskbar 查看各 Agent、結果並單獨停止。",
 commandBusy: "目前會話有工作正在進行，請等它結束或先停止，再啟動 workflow。",
 demoInput: "分別從三個實用角度分析如何讓團隊任務交接更清楚，再合併為簡短建議。",
 count:'{count} 個 task',current:'目前會話',stopAll:'全部停止',stoppingAll:'停止中…',stop:'停止 Agent',collapse:'收起 task 清單',expand:'展開 task 清單',empty:'目前會話還沒有 Agent task',emptyHint:'執行 workflow 後，任務會顯示在這裡。',ended:'已結束',logs:'工作紀錄',result:'結果',scroll:'捲動查看更多',loadError:'無法載入 workflow 任務。',stopError:'未能停止所選任務。',retry:'重試',rerun:'重新執行整個 workflow',retryError:'未能重新執行 workflow。',retryUnavailable:'此舊紀錄請用 /workflow 重新啟動。',loading:'正在載入任務…',waiting:'{count} 個等待你確認',failures:'{count} 個失敗',complete:'任務已結束',working:'Agent 正在工作',states:{pausing:'暫停中',paused:'已暫停',queued:'排隊中',running:'執行中',waiting:'等待工具',approval:'等待你確認',retrying:'重試中',stopping:'停止中',completed:'已完成',failed:'失敗',stopped:'已停止'}
}
export const workflowId: WorkflowUiMessages = {
 pause: 'Jeda Agent', resume: 'Lanjutkan Agent', tasks: 'Task',
 categories: { paused: 'Dijeda', active: 'Sedang berjalan', completed: 'Selesai', failed: 'Gagal', stopped: 'Dihentikan' }, partialFailure: 'Selesai dengan Agent gagal',
 commandHint: "Lihat workflow atau jalankan /workflow <nama> <tugas>",
 commandUsage: "Gunakan `/workflow demo` untuk mencoba demo, atau `/workflow <nama> <tugas>` untuk menjalankan workflow. Path absolut .ts/.mts dalam tanda kutip juga didukung.",
 commandAttachments: "Tulis path file di tugas workflow dan hapus lampiran composer sebelum memulai; lampiran belum dikirim.",
 commandUnknown: "Workflow tidak dikenal: {name}. Gunakan /workflow untuk melihat daftar.",
 commandInput: "Jelaskan tugas setelah nama workflow.",
 commandWorkspace: "Pilih direktori proyek sebelum memulai workflow.",
 commandStarted: "{name} dimulai. Lihat Agent, hasil, dan kontrol berhenti di taskbar.",
 commandBusy: "Tunggu pekerjaan chat selesai atau hentikan sebelum memulai workflow lain.",
 demoInput: "Bandingkan tiga cara praktis untuk memperjelas serah terima tugas tim, lalu gabungkan temuan menjadi rekomendasi singkat.",
 count:'{count} task',current:'Chat saat ini',stopAll:'Hentikan semua',stoppingAll:'Menghentikan…',stop:'Hentikan Agent',collapse:'Tutup daftar task',expand:'Buka daftar task',empty:'Belum ada task Agent di chat ini',emptyHint:'Task akan muncul saat workflow dimulai.',ended:'Selesai',logs:'Log kerja',result:'Hasil',scroll:'Gulir untuk melihat lainnya',loadError:'Task workflow tidak dapat dimuat.',stopError:'Pekerjaan yang dipilih tidak dapat dihentikan.',retry:'Coba lagi',rerun:'Jalankan ulang seluruh workflow',retryError:'Workflow tidak dapat dimulai ulang.',retryUnavailable:'Mulai workflow lama ini lagi dengan /workflow.',loading:'Memuat task…',waiting:'{count} menunggu konfirmasi',failures:'{count} gagal',complete:'Semua task selesai',working:'Agent sedang bekerja',states:{pausing:'Menjeda',paused:'Dijeda',queued:'Antrean',running:'Berjalan',waiting:'Menunggu alat',approval:'Menunggu Anda',retrying:'Mencoba lagi',stopping:'Menghentikan',completed:'Selesai',failed:'Gagal',stopped:'Dihentikan'}
}
