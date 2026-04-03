import { reactive } from 'vue';

class GlobalState {
  loading = false;
}

export const globalStore = reactive(new GlobalState());
