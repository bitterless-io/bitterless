import { app, ipcMain } from 'electron';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const RIGCHAT_DIR = 'rigchat';
const RIGCHAT_IMAGES_DIR = join(RIGCHAT_DIR, 'images');

let bitterlessPath = '';
let bitterlessDbPath = '';
let skillsPath = '';
let pluginsPath = '';
let rigchatPath = '';
let rigchatImagesPath = '';

const initBitterless = (): void => {
  const userDataPath = app.getPath('userData');
  bitterlessPath = userDataPath;
  bitterlessDbPath = join(userDataPath, 'db');
  if (!existsSync(bitterlessDbPath)) {
    mkdirSync(bitterlessDbPath, { recursive: true });
    console.log('[directory] created bitterless/db:', bitterlessDbPath);
  }
  skillsPath = join(userDataPath, 'skills');
  if (!existsSync(skillsPath)) {
    mkdirSync(skillsPath, { recursive: true });
    console.log('[directory] created skills:', skillsPath);
  }
  pluginsPath = join(userDataPath, 'plugins');
  if (!existsSync(pluginsPath)) {
    mkdirSync(pluginsPath, { recursive: true });
    console.log('[directory] created plugins:', pluginsPath);
  }
};

const initRigchat = (): void => {
  const userDataPath = app.getPath('userData');
  rigchatPath = join(userDataPath, RIGCHAT_DIR);
  rigchatImagesPath = join(userDataPath, RIGCHAT_IMAGES_DIR);
  if (!existsSync(rigchatImagesPath)) {
    mkdirSync(rigchatImagesPath, { recursive: true });
    console.log('[directory] created rigchat/images:', rigchatImagesPath);
  }
};

const registerIpc = (): void => {
  ipcMain.handle('bitterless:get-app-path', () => app.getAppPath());
  ipcMain.handle('bitterless:get-userdata-path', () => bitterlessPath);
  ipcMain.handle('bitterless:get-db-path', () => bitterlessDbPath);
  ipcMain.handle('bitterless:get-skills-path', () => skillsPath);
  ipcMain.handle('bitterless:get-plugins-path', () => pluginsPath);
  ipcMain.handle('rigchat:get-path', () => rigchatPath);
  ipcMain.handle('rigchat:get-images-path', () => rigchatImagesPath);
};

export const getUserDataPath = (): string => bitterlessPath;

export const getDbPath = (): string => bitterlessDbPath;

export const getSkillsPath = (): string => skillsPath;

export const getPluginsPath = (): string => pluginsPath;

export const initDirectory = (): void => {
  initBitterless();
  initRigchat();
  registerIpc();
};
