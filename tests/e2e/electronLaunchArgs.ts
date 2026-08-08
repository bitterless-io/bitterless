interface BitterlessE2ELaunchArgsOptions {
  platform: NodeJS.Platform;
  applicationPath: string;
  applicationArguments?: readonly string[];
}

export const buildBitterlessE2ELaunchArgs = ({
  platform,
  applicationPath,
  applicationArguments = []
}: BitterlessE2ELaunchArgsOptions): string[] => [
  ...(platform === 'darwin' ? ['--use-mock-keychain'] : []),
  applicationPath,
  ...applicationArguments
];
