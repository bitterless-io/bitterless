export type PackageInfo = {
  name: string;
  version: string;
  versionCode: number;
  description: string;
  repository: string;
  author: string;
  license: string;
  homepage: string;
};

export type PackageHelperApi = {
  getPackageInfo: () => Promise<PackageInfo>;
};
