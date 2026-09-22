import 'electron-xpc/preload';
import '@preload/maestroSdk';
import { exposeOnlyPreviewEnv } from './onlyPreviewEnv.preload';

exposeOnlyPreviewEnv();
