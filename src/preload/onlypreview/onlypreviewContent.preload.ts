import 'electron-xpc/preload';
import { exposeOnlyPreviewEnv } from './onlyPreviewEnv.preload';

exposeOnlyPreviewEnv();
