import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoistSyncStatusEmitter } from '../emitter/todoistSync.emitter';
import { resolveTodoUnavailableReason } from './todoSessionState.service';

type TodoMutationFailureRecovery = () => Promise<void>;

let mutationFailureRecovery: TodoMutationFailureRecovery | null = null;

export const registerTodoMutationFailureRecovery = (
  recovery: TodoMutationFailureRecovery,
): (() => void) => {
  mutationFailureRecovery = recovery;
  return () => {
    if (mutationFailureRecovery === recovery) mutationFailureRecovery = null;
  };
};

export const scheduleTodoMutationFailureRecovery = (): void => {
  const recovery = mutationFailureRecovery;
  if (!recovery) return;
  void Promise.resolve()
    .then(recovery)
    .catch((error) => {
      console.error('[todo] mutation failure recovery failed:', error);
    });
};

export const observeTodoMutation = async <T>(mutation: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await mutation();
  } catch (error) {
    console.error('[todo] mutation failed:', error);
    try {
      const reason = await resolveTodoUnavailableReason(todoistSyncStatusEmitter);
      Message.error(i18nHelper.todo[reason]);
    } catch (notificationError) {
      console.error('[todo] mutation failure notification failed:', notificationError);
    }
    scheduleTodoMutationFailureRecovery();
    return undefined;
  }
};
