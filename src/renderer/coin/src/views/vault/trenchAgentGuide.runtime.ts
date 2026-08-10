import { reactive } from 'vue';
import { trenchAgentGuideClient } from './trenchAgentGuide.client';
import { TrenchAgentGuideStore } from './trenchAgentGuide.store';

export const trenchAgentGuideStore = reactive(new TrenchAgentGuideStore(
  trenchAgentGuideClient,
  {
    writeText: async (text) => await navigator.clipboard.writeText(text),
  },
));
