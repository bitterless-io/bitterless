import path from 'node:path';
import type { ClaudeAccountExecutionContext } from './claudeAccount.repository';
import { ClaudeExecutionError } from './claudeSubscription.errors';

const PASSTHROUGH_VARIABLES = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'PROCESSOR_ARCHITECTURE',
  'OS'
] as const;

export const CLAUDE_COMPETING_AUTH_VARIABLES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_AWS_REGION',
  'ANTHROPIC_AWS_ROLE_ARN',
  'ANTHROPIC_GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_GOOGLE_CLOUD_REGION',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_HOST_CREDS_FILE',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_API_KEY_HELPER',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_OAUTH_TOKEN_FD',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'AZURE_API_KEY',
  'AZURE_OPENAI_API_KEY'
] as const;

export const buildClaudeSubscriptionEnvironment = (
  parentEnvironment: NodeJS.ProcessEnv,
  context: ClaudeAccountExecutionContext
): Record<string, string> => {
  const expectedAnthropicDirectory = path.join(context.configDirectory, 'anthropic');
  if (
    !path.isAbsolute(context.configDirectory) ||
    !path.isAbsolute(context.secureStorageConfigDirectory) ||
    !path.isAbsolute(context.anthropicConfigDirectory) ||
    context.configDirectory !== context.configDirectory.normalize('NFC') ||
    context.secureStorageConfigDirectory !== context.secureStorageConfigDirectory.normalize('NFC') ||
    context.anthropicConfigDirectory !== context.anthropicConfigDirectory.normalize('NFC') ||
    context.secureStorageConfigDirectory !== context.configDirectory ||
    context.anthropicConfigDirectory !== expectedAnthropicDirectory
  ) {
    throw new ClaudeExecutionError('The selected Claude account directories are invalid.');
  }

  const environment: Record<string, string> = {};
  for (const name of PASSTHROUGH_VARIABLES) {
    const value = parentEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }

  environment.CLAUDE_CONFIG_DIR = context.configDirectory;
  environment.CLAUDE_SECURESTORAGE_CONFIG_DIR = context.secureStorageConfigDirectory;
  environment.ANTHROPIC_CONFIG_DIR = context.anthropicConfigDirectory;
  environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  environment.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1';
  environment.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = '1';
  return environment;
};
