import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { PackageInfo } from '../shared/packageHelper.type';

// Define the type matching PackageMainHelper methods
interface PackageMainHelperType {
  getPackageInfo(): Promise<PackageInfo>;
}

export const packageHelper = createXpcRendererEmitter<PackageMainHelperType>('PackageMainHelper');

export type { PackageInfo, PackageHelperApi } from '../shared/packageHelper.type';
