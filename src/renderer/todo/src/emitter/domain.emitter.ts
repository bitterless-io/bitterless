import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { DomainDao } from '@preload/sqlite/dao/domain.dao';

export const domainEmitter = createXpcRendererEmitter<DomainDao>('DomainDao');
