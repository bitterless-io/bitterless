import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { EyesOnAgentsWindowApi } from '@shared/eyesOnAgents/eyesOnAgentsWindow.type';

export const eyesOnAgentsWindowEmitter =
  createXpcRendererEmitter<EyesOnAgentsWindowApi>('EyesOnAgentsWindowHandler');
