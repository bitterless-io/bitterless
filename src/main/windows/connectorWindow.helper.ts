import { BrowserWindowConstructorOptions } from 'electron';
import { WindowHelper } from './window.helper';

class ConnectorWindowHelper extends WindowHelper {
  protected preloadFile = 'connector.js';
  protected rendererPath = 'connector/index.html';
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {
    title: 'Connector',
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  };
}

export const connectorWindowHelper = new ConnectorWindowHelper();
