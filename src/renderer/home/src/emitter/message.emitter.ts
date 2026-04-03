import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { MessageDao }from '@preload/sqlite/dao/message.dao'



export const messageEmitter = createXpcRendererEmitter<MessageDao>('MessageDao');
