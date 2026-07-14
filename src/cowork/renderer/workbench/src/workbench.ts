import { createApp } from 'vue'
import '@arco-design/web-vue/dist/arco.css'
import '../../common/style.css'
import WorkbenchApp from './WorkbenchApp.vue'
import { workbenchRouter } from './workbench.router'

createApp(WorkbenchApp).use(workbenchRouter).mount('#app')
