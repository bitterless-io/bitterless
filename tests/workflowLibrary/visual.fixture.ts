import { createApp } from 'vue'
import Arco from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.css'
import WorkbenchWorkflowsView from '../../src/renderer/maestro/workbench/src/views/WorkbenchWorkflowsView.vue'
import { workflowLibraryStore } from '../../src/renderer/maestro/workbench/src/workflowLibrary.store'
Object.assign(window, { workflowVisualStore: workflowLibraryStore })
createApp(WorkbenchWorkflowsView).use(Arco).mount('#app')
