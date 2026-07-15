export type PathName =
  | 'home'
  | 'appData'
  | 'userData'
  | 'sessionData'
  | 'temp'
  | 'exe'
  | 'module'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | 'recent'
  | 'logs'
  | 'crashDumps';

export type PathHelperApi = {
  getAppPath: () => Promise<string>;
  getPath: (name: PathName) => Promise<string>;
  getUserDataPath: () => Promise<string>;
  openPath: (path: string) => Promise<string>;
};
