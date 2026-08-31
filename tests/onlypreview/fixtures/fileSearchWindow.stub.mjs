export const fileSearchWindowService = {
  inspectTarget: async () => {
    throw new Error('Target inspection is not configured in this unit test.');
  },
  bindOfficeWorkspace: async () => undefined,
  bindProjectWorkspace: async ({ workspaceId }) => ({
    runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
    workspaceId,
    workspaceGeneration: 1
  }),
  revokeProjectWorkspace: async () => undefined,
  authorizeProjectItem: async () => {
    throw new Error('Project authority is not configured in this unit test.');
  },
  authorizeProjectRoot: async () => {
    throw new Error('Project authority is not configured in this unit test.');
  },
  prepareProjectDelete: async () => {
    throw new Error('Project Delete is not configured in this unit test.');
  },
  commitProjectDelete: async () => {
    throw new Error('Project Delete is not configured in this unit test.');
  },
  cancelProjectDelete: async () => undefined,
  prepareOfficeRead: async () => {
    throw new Error('Office reads are not configured in this unit test.');
  },
  openOfficeRead: async () => {
    throw new Error('Office reads are not configured in this unit test.');
  },
  readNextOfficeChunk: async () => {
    throw new Error('Office reads are not configured in this unit test.');
  },
  cancelOfficeRead: async () => undefined
};
