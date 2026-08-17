import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import {
  SUBMODULES_HANDLER_NAME,
  SUBMODULES_SYSTEM_HANDLER_NAME,
  SUBMODULES_WINDOW_HANDLER_NAME,
  type SubmodulesApi,
  type SubmodulesSystemApi,
  type SubmodulesWindowApi
} from '@shared/submodules/submodules.type';

/** Reading and watching live in this window's own preload. */
export const submodulesEmitter = createXpcRendererEmitter<SubmodulesApi>(
  SUBMODULES_HANDLER_NAME
) as SubmodulesApi;

/** Directory dialog and IDE launch live in Main. */
export const submodulesSystemEmitter = createXpcRendererEmitter<SubmodulesSystemApi>(
  SUBMODULES_SYSTEM_HANDLER_NAME
) as SubmodulesSystemApi;

export const submodulesWindowEmitter = createXpcRendererEmitter<SubmodulesWindowApi>(
  SUBMODULES_WINDOW_HANDLER_NAME
) as SubmodulesWindowApi;
