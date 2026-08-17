import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import {
  SUBMODULES_WINDOW_HANDLER_NAME,
  type SubmodulesWindowApi
} from '@shared/submodules/submodules.type';

export const submodulesWindowEmitter = createXpcRendererEmitter<SubmodulesWindowApi>(
  SUBMODULES_WINDOW_HANDLER_NAME
) as SubmodulesWindowApi;
