import { todoEnv } from '../contextBridge/todoEnv.bridge';
import type { TodoRendererMutationRequest } from '@shared/todoistSync/todoDataUpdate.shared';

export const emitTodoMutation = <Params, Result>(
  operation: (request: TodoRendererMutationRequest<Params>) => Promise<Result>,
  params: Params,
): Promise<Result> => {
  return operation({
    originRendererId: todoEnv.originRendererId,
    params,
  });
};
