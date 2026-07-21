import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { DomainMcpDaoApi } from '@shared/mcp/todoMcpDao.type';

export const domainEmitter =
  createXpcRendererEmitter<DomainMcpDaoApi>('TodoistSyncDomainHandler');
