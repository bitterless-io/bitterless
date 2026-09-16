import { createApp } from 'vue'
import Arco from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.css'
import WorkbenchWorkflowsView from '../../src/renderer/maestro/workbench/src/views/WorkbenchWorkflowsView.vue'
createApp(WorkbenchWorkflowsView).use(Arco).mount('#app')
