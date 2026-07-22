import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

export const observeTodoMutation = async <T>(mutation: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await mutation();
  } catch (error) {
    console.error('[todo] mutation failed:', error);
    try {
      Message.error(i18nHelper.todo.runtimeUnavailable);
    } catch (notificationError) {
      console.error('[todo] mutation failure notification failed:', notificationError);
    }
    return undefined;
  }
};
