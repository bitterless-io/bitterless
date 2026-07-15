import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface HelpEntry {
  usage: string
  summary: string
  commands?: string[]
  options?: string[]
}

const fallbackManual = `# micromeet CLI Manual

Run micromeet manual from the source package to read the complete manual.

Primary commands:
  micromeet crms login
  micromeet crms auth status
  micromeet crms mcu records
  micromeet sys login
  micromeet sys auth status
  micromeet sys me
`

const globalOptions = [
  '--base-url <url>          Override the resolved API base URL.',
  '--region <SG|HK|ID>       Select a Micromeet region; required for standalone CRMS login.',
  '--token <jwt>             Override the stored realm token.',
  '--workspace-id <id>       Override the CRMS workspace.',
  '--credential-file <path>  Override the realm credential file.',
  '--json                    Emit machine-readable JSON when supported.',
  '--debug                   Print unexpected error stacks.',
  '-h, --help                Show help for the current command path.'
]

const pagedListOptions = [
  '--page <n>                Page number, default 1.',
  '--page-size <n>           Page size, default 20.',
  '--keyword <text>          Search text.',
  '--status <status>         Filter by status.'
]

const helpEntries: Record<string, HelpEntry> = {
  crms: {
    usage: 'micromeet crms <module> <function> [options]',
    summary: 'Tenant and institution operations authenticated with the CRMS credential.',
    commands: [
      'login | logout',
      'auth status | set-password',
      'curl',
      'mcu',
      'mapping',
      'patients',
      'corporates',
      'migration',
      'settings'
    ]
  },
  'crms login': {
    usage: 'micromeet crms login [options]',
    summary: 'Log in through /share/auth/password-login and save the encrypted CRMS credential.',
    options: [
      '--email <email>          Login email; prompts when omitted.',
      '--password <password>    Login password; hidden prompt when omitted.',
      '--region <SG|HK|ID>      Required unless inheriting a Maestro-selected region.',
      '--language <language>    Login language, default en.'
    ]
  },
  'crms logout': {
    usage: 'micromeet crms logout [--json]',
    summary: 'Remove the local CRMS credential and any legacy plaintext CRMS session.'
  },
  'crms auth': {
    usage: 'micromeet crms auth <function> [options]',
    summary: 'Inspect CRMS authentication.',
    commands: ['status', 'set-password']
  },
  'crms auth status': {
    usage: 'micromeet crms auth status [--check] [--json]',
    summary: 'Show credential resolution; --check also requests the current CRMS profile.',
    options: ['--check                   Verify the token with /share/user/profile/detail.']
  },
  'crms auth set-password': {
    usage: 'micromeet crms auth set-password [options]',
    summary: 'Set the first-login password and activate an invited CRMS account.',
    options: ['--password <password>    New password; hidden prompt when omitted.']
  },
  'crms curl': {
    usage: 'micromeet crms curl [method] <url-or-path> [options]',
    summary: 'Send a curl-like HTTP request using CRMS authentication by default.',
    options: [
      '-X, --request <method>   Override the HTTP method.',
      '-H, --header <k: v>      Add a repeatable request header.',
      '-d, --data <body>        Send text, JSON, @file, or @- stdin data.',
      '--query <key=value>      Add a repeatable query parameter.',
      '-G, --get                Send data as query parameters.',
      '-i, --include            Include response status and headers.',
      '-o, --output <path>      Write the response to a file.',
      '--auth | --no-auth       Force the Micromeet auth decision.',
      '--fail                   Exit 22 for HTTP status >= 400.',
      '--timeout <ms>           Request timeout in milliseconds.'
    ]
  },
  'crms mcu': {
    usage: 'micromeet crms mcu <function> [options]',
    summary: 'Medical check-up records, conclusions, reports, status, and queue operations.',
    commands: [
      'records',
      'status-overview',
      'queue tick',
      'record detail | create | patient-info update | diagnostic-data update | conclusion update | validate',
      'conclusion generate',
      'report generate | send | download'
    ]
  },
  'crms mcu records': {
    usage: 'micromeet crms mcu records [options]',
    summary: 'List MCU records.',
    options: [
      ...pagedListOptions,
      '--fit-status <status>       Filter by fitness status.',
      '--user-type <type>          Filter by user type.',
      '--corporate-id <id>         Filter by corporate.',
      '--project-id <id>           Filter by project.'
    ]
  },
  'crms mcu status-overview': {
    usage: 'micromeet crms mcu status-overview [options]',
    summary: 'Return aggregate MCU workflow statuses.',
    options: [
      '--source-institution-id <id>',
      '--medical-client-id <id>',
      '--corporate-id <id>',
      '--project-id <id>',
      '--body <json|@file>      Supply the request object directly.'
    ]
  },
  'crms mcu queue': {
    usage: 'micromeet crms mcu queue <function> [options]',
    summary: 'Run MCU queue operations.',
    commands: ['tick']
  },
  'crms mcu queue tick': {
    usage: 'micromeet crms mcu queue tick [--json]',
    summary: 'Trigger one MCU queue processing tick.'
  },
  'crms mcu record': {
    usage: 'micromeet crms mcu record <function> [options]',
    summary: 'Read, create, update, and validate MCU records.',
    commands: ['detail', 'create', 'patient-info update', 'diagnostic-data update', 'conclusion update', 'validate']
  },
  'crms mcu record detail': {
    usage: 'micromeet crms mcu record detail --id <mcu-record-id> [--json]',
    summary: 'Get an MCU record summary.',
    options: ['--id <id>                Required MCU record id.']
  },
  'crms mcu record create': {
    usage: 'micromeet crms mcu record create --patient-id <id> [options]',
    summary: 'Create an MCU record.',
    options: [
      '--patient-id <id>            Required unless supplied in --body.',
      '--source-institution-id <id>',
      '--medical-client-id <id>',
      '--corporate-id <id>',
      '--project-id <id>',
      '--outer-mcu-id <id>',
      '--operator-user-id <id>',
      '--user-type <type>',
      '--body <json|@file>           Supply the request object directly.'
    ]
  },
  'crms mcu record patient-info': {
    usage: 'micromeet crms mcu record patient-info <function> [options]',
    summary: 'Update MCU patient information.',
    commands: ['update']
  },
  'crms mcu record patient-info update': {
    usage: 'micromeet crms mcu record patient-info update --body <json|@file> [--json]',
    summary: 'Update basic_info and/or company_info for an MCU record.',
    options: ['--body <json|@file>      Object with mcu_record_id and basic_info and/or company_info.']
  },
  'crms mcu record diagnostic-data': {
    usage: 'micromeet crms mcu record diagnostic-data <function> [options]',
    summary: 'Update MCU diagnostic data.',
    commands: ['update']
  },
  'crms mcu record diagnostic-data update': {
    usage: 'micromeet crms mcu record diagnostic-data update --body <json|@file> [--json]',
    summary: 'Update diagnostic_data for one MCU report type.',
    options: ['--body <json|@file>      Object with mcu_record_id, report_type, and diagnostic_data.']
  },
  'crms mcu record conclusion': {
    usage: 'micromeet crms mcu record conclusion <function> [options]',
    summary: 'Update MCU conclusions.',
    commands: ['update']
  },
  'crms mcu record conclusion update': {
    usage: 'micromeet crms mcu record conclusion update --body <json|@file> [--json]',
    summary: 'Update conclusion findings, recommendations, or fitness.',
    options: ['--body <json|@file>      Object with mcu_record_id and conclusion fields.']
  },
  'crms mcu record validate': {
    usage: 'micromeet crms mcu record validate --ids <id[,id]> [options]',
    summary: 'Validate one or more MCU records.',
    options: ['--ids <id[,id]>         Required MCU record ids.', '--body <json|@file>      Supply the request object directly.']
  },
  'crms mcu conclusion': {
    usage: 'micromeet crms mcu conclusion <function> [options]',
    summary: 'Generate MCU conclusions.',
    commands: ['generate']
  },
  'crms mcu conclusion generate': {
    usage: 'micromeet crms mcu conclusion generate [--ids <id[,id]>] [options]',
    summary: 'Generate conclusions for selected or eligible MCU records.',
    options: ['--ids <id[,id]>         Optional MCU record ids.', '--force                  Force regeneration.', '--body <json|@file>      Supply the request object directly.']
  },
  'crms mcu report': {
    usage: 'micromeet crms mcu report <function> [options]',
    summary: 'Generate, send, and download MCU reports.',
    commands: ['generate', 'send', 'download']
  },
  'crms mcu report generate': {
    usage: 'micromeet crms mcu report generate --ids <id[,id]> [options]',
    summary: 'Generate reports for one or more MCU records.',
    options: [
      '--ids <id[,id]>                  Required MCU record ids.',
      '--pdf-file-name-mode <mode>      Default mcu_id_name.',
      '--force                          Force regeneration.',
      '--body <json|@file>              Supply the request object directly.'
    ]
  },
  'crms mcu report send': {
    usage: 'micromeet crms mcu report send --ids <id[,id]> [options]',
    summary: 'Send reports for one or more MCU records.',
    options: ['--ids <id[,id]>         Required MCU record ids.', '--body <json|@file>      Supply the request object directly.']
  },
  'crms mcu report download': {
    usage: 'micromeet crms mcu report download --id <mcu-record-id> [--json]',
    summary: 'Get the report download result for an MCU record.',
    options: ['--id <id>                Required MCU record id.']
  },
  'crms patients': {
    usage: 'micromeet crms patients <function> [options]',
    summary: 'Manage CRMS patients.',
    commands: ['list', 'detail', 'create', 'update', 'delete']
  },
  'crms patients list': {
    usage: 'micromeet crms patients list [options]',
    summary: 'List patients.',
    options: pagedListOptions
  },
  'crms patients detail': {
    usage: 'micromeet crms patients detail --id <patient-id> [--json]',
    summary: 'Get one patient.',
    options: ['--id <id>                Required patient id.']
  },
  'crms patients create': {
    usage: 'micromeet crms patients create --full-name <name> [options]',
    summary: 'Create a patient.',
    options: [
      '--full-name <name>       Required unless supplied in --body.',
      '--gender <value>',
      '--birth-date <date>',
      '--national-id <id>',
      '--phone <phone>',
      '--ihs-number <value>',
      '--address <address>',
      '--status <status>',
      '--note <note>',
      '--body <json|@file>      Supply the request object directly.'
    ]
  },
  'crms patients update': {
    usage: 'micromeet crms patients update --id <patient-id> [options]',
    summary: 'Update a patient.',
    options: ['--id <id>                Required patient id.', '--body <json|@file>      Supply all update fields directly.']
  },
  'crms patients delete': {
    usage: 'micromeet crms patients delete --id <patient-id> [--json]',
    summary: 'Delete a patient through the Core domain endpoint.',
    options: ['--id <id>                Required patient id.']
  },
  'crms corporates': {
    usage: 'micromeet crms corporates <function> [options]',
    summary: 'Manage corporate clients and their projects.',
    commands: ['list', 'detail', 'create', 'update', 'delete', 'projects']
  },
  'crms corporates list': {
    usage: 'micromeet crms corporates list [options]',
    summary: 'List corporate clients.',
    options: pagedListOptions
  },
  'crms corporates detail': {
    usage: 'micromeet crms corporates detail --id <corporate-id> [--json]',
    summary: 'Get one corporate client.',
    options: ['--id <id>                Required corporate id.']
  },
  'crms corporates create': {
    usage: 'micromeet crms corporates create --name <name> [options]',
    summary: 'Create a corporate client.',
    options: ['--name <name>            Required unless supplied in --body.', '--code <code>', '--address <address>', '--status <status>', '--note <note>', '--prompt <prompt>', '--body <json|@file>']
  },
  'crms corporates update': {
    usage: 'micromeet crms corporates update --id <corporate-id> [options]',
    summary: 'Update a corporate client.',
    options: ['--id <id>                Required unless supplied in --body.', '--name <name>', '--code <code>', '--address <address>', '--status <status>', '--note <note>', '--prompt <prompt>', '--body <json|@file>']
  },
  'crms corporates delete': {
    usage: 'micromeet crms corporates delete --id <corporate-id> [--json]',
    summary: 'Delete a corporate client through the Core domain endpoint.',
    options: ['--id <id>                Required corporate id.']
  },
  'crms corporates projects': {
    usage: 'micromeet crms corporates projects <function> [options]',
    summary: 'Manage corporate projects.',
    commands: ['list', 'detail', 'create', 'update', 'delete']
  },
  'crms corporates projects list': {
    usage: 'micromeet crms corporates projects list [options]',
    summary: 'List corporate projects.',
    options: [...pagedListOptions, '--corporate-id <id>       Filter by corporate.']
  },
  'crms corporates projects detail': {
    usage: 'micromeet crms corporates projects detail --id <project-id> [--json]',
    summary: 'Get one corporate project.',
    options: ['--id <id>                Required project id.']
  },
  'crms corporates projects create': {
    usage: 'micromeet crms corporates projects create --name <name> [options]',
    summary: 'Create a corporate project.',
    options: ['--name <name>            Required unless supplied in --body.', '--corporate-id <id>', '--code <code>', '--status <status>', '--batch-date <date>', '--period-start <date>', '--period-end <date>', '--note <note>', '--prompt <prompt>', '--body <json|@file>']
  },
  'crms corporates projects update': {
    usage: 'micromeet crms corporates projects update --id <project-id> [options]',
    summary: 'Update a corporate project.',
    options: ['--id <id>                Required unless supplied in --body.', '--corporate-id <id>', '--name <name>', '--code <code>', '--status <status>', '--batch-date <date>', '--period-start <date>', '--period-end <date>', '--note <note>', '--prompt <prompt>', '--body <json|@file>']
  },
  'crms corporates projects delete': {
    usage: 'micromeet crms corporates projects delete --id <project-id> [--json]',
    summary: 'Delete a corporate project through the Core domain endpoint.',
    options: ['--id <id>                Required project id.']
  },
  'crms mapping': {
    usage: 'micromeet crms mapping <function> [options]',
    summary: 'Inspect and maintain MCU field and data mappings.',
    commands: ['field-config', 'data-map list | upsert | delete | bulk-status', 'file confirm']
  },
  'crms mapping field-config': {
    usage: 'micromeet crms mapping field-config [options]',
    summary: 'Get MCU field configuration.',
    options: ['--language <language>    Select config language.', '--mcu-type <type>        Return one MCU type from the config.']
  },
  'crms mapping data-map': {
    usage: 'micromeet crms mapping data-map <function> [options]',
    summary: 'Manage MCU data-map rows.',
    commands: ['list', 'upsert', 'delete', 'bulk-status']
  },
  'crms mapping data-map list': {
    usage: 'micromeet crms mapping data-map list --mcu-type <type> [options]',
    summary: 'List MCU data-map rows.',
    options: ['--mcu-type <type>        Required MCU type.', '--status <status>         Filter by status.']
  },
  'crms mapping data-map upsert': {
    usage: 'micromeet crms mapping data-map upsert --mcu-type <type> --column-name <name> [options]',
    summary: 'Create or update an MCU data-map row.',
    options: ['--id <id>', '--mcu-type <type>        Required.', '--column-name <name>     Required.', '--system-field <field>', '--status <status>', '--check-unit <unit>', '--check-method <method>', '--reference <value>', '--body <json|@file>']
  },
  'crms mapping data-map delete': {
    usage: 'micromeet crms mapping data-map delete --id <data-map-id> [--json]',
    summary: 'Delete one MCU data-map row.',
    options: ['--id <id>                Required data-map id.']
  },
  'crms mapping data-map bulk-status': {
    usage: 'micromeet crms mapping data-map bulk-status --ids <id[,id]> --status <status> [options]',
    summary: 'Update status for multiple MCU data-map rows.',
    options: ['--ids <id[,id]>         Required data-map ids.', '--status <status>        Required status.', '--body <json|@file>      Supply the request object directly.']
  },
  'crms mapping file': {
    usage: 'micromeet crms mapping file <function> [options]',
    summary: 'Confirm file mapping results.',
    commands: ['confirm']
  },
  'crms mapping file confirm': {
    usage: 'micromeet crms mapping file confirm --body <json|@file> [--json]',
    summary: 'Confirm mappings parsed from an MCU file.',
    options: ['--body <json|@file>      Object with mcu_type, optional mcu_file_id, and maps[].']
  },
  'crms migration': {
    usage: 'micromeet crms migration <function> [options]',
    summary: 'Run protected tenant provisioning and account migration operations.',
    commands: ['provision', 'account']
  },
  'crms migration provision': {
    usage: 'micromeet crms migration provision --admin-email <email> --tenant-name <name> [options]',
    summary: 'Provision migration tenant resources.',
    options: ['--admin-email <email>       Required.', '--tenant-name <name>        Required.', '--admin-name <name>', '--tenant-code <code>', '--institution-name <name>', '--institution-code <code>', '--migration-token <token>   Or MICROMEET_MIGRATION_TOKEN.', '--body <json|@file>']
  },
  'crms migration account': {
    usage: 'micromeet crms migration account --source <email> --target <email> [options]',
    summary: 'Migrate account data; dry-run unless --apply is supplied.',
    options: ['--source <email>            Required.', '--target <email>            Required.', '--domains <a,b>             Limit migration domains.', '--apply                     Perform the migration.', '--timeout <ms>              Default 300000.', '--migration-token <token>   Or MICROMEET_MIGRATION_TOKEN.', '--body <json|@file>']
  },
  'crms settings': {
    usage: 'micromeet crms settings <function> [options]',
    summary: 'Inspect CRMS tenant and institution settings.',
    commands: ['detail']
  },
  'crms settings detail': {
    usage: 'micromeet crms settings detail [--json]',
    summary: 'Get effective tenant, institution, branding, and permission settings.'
  },
  sys: {
    usage: 'micromeet sys <function> [options]',
    summary: 'Platform administration operations authenticated with the Sys credential.',
    commands: ['login', 'logout', 'auth status', 'me', 'curl']
  },
  'sys login': {
    usage: 'micromeet sys login [options]',
    summary: 'Log in through /sys/auth/login and save the encrypted Sys credential.',
    options: ['--email <email>          Login email; prompts when omitted.', '--password <password>    Login password; hidden prompt when omitted.']
  },
  'sys logout': {
    usage: 'micromeet sys logout [--json]',
    summary: 'Remove the local Sys credential.'
  },
  'sys auth': {
    usage: 'micromeet sys auth <function> [options]',
    summary: 'Inspect Sys authentication.',
    commands: ['status']
  },
  'sys auth status': {
    usage: 'micromeet sys auth status [--check] [--json]',
    summary: 'Show Sys credential resolution; --check also requests /sys/me.',
    options: ['--check                   Verify the token with /sys/me.']
  },
  'sys me': {
    usage: 'micromeet sys me [--json]',
    summary: 'Get the current Sys administrator profile.'
  },
  'sys curl': {
    usage: 'micromeet sys curl [method] <url-or-path> [options]',
    summary: 'Send a curl-like HTTP request using Sys authentication by default.',
    options: [
      '-X, --request <method>   Override the HTTP method.',
      '-H, --header <k: v>      Add a repeatable request header.',
      '-d, --data <body>        Send text, JSON, @file, or @- stdin data.',
      '--query <key=value>      Add a repeatable query parameter.',
      '-G, --get                Send data as query parameters.',
      '-i, --include            Include response status and headers.',
      '-o, --output <path>      Write the response to a file.',
      '--auth | --no-auth       Force the Micromeet auth decision.',
      '--fail                   Exit 22 for HTTP status >= 400.',
      '--timeout <ms>           Request timeout in milliseconds.'
    ]
  },
  manual: {
    usage: 'micromeet manual',
    summary: 'Write the complete Markdown CLI manual to stdout.'
  },
  modules: {
    usage: 'micromeet modules',
    summary: 'Print the complete command tree in compact text form.'
  }
}

const crmsCompatibilityAliases = new Set(['auth', 'curl', 'mcu', 'mapping', 'patients', 'corporates', 'migration', 'settings'])

const normalizeHelpPath = (path: string[]): string[] => {
  if (path.length && crmsCompatibilityAliases.has(path[0])) return ['crms', ...path]
  return path
}

const formatRows = (heading: string, rows: string[]): string => `${heading}:\n${rows.map((row) => `  ${row}`).join('\n')}`

const formatHelpEntry = (entry: HelpEntry): string => {
  const sections = [entry.usage, entry.summary]
  if (entry.commands?.length) sections.push(formatRows('Commands', entry.commands))
  if (entry.options?.length) sections.push(formatRows('Options', entry.options))
  sections.push(formatRows('Global options', globalOptions))
  sections.push('Discovery:\n  micromeet help <command-path>\n  micromeet <command-path> help\n  micromeet <command-path> --help')
  return sections.join('\n\n')
}

export const readManual = (): string => {
  const candidates = [
    join(__dirname, '..', 'MANUAL.md'),
    join(__dirname, '..', '..', 'MANUAL.md'),
    join(process.cwd(), 'apps', 'cli', 'MANUAL.md')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
  }
  return fallbackManual
}

export const modulesText = (): string => `micromeet command tree

crms
  login | logout | auth status | auth set-password
  curl        [method] <url-or-path> [curl-like options]
  mcu         records | status-overview | queue tick | record detail | record create | record patient-info update | record diagnostic-data update | record conclusion update | record validate | conclusion generate | report generate | report send | report download
  mapping     field-config | data-map list | data-map upsert | data-map delete | data-map bulk-status | file confirm
  patients    list | detail | create | update | delete
  corporates  list | detail | create | update | delete | projects list | projects detail | projects create | projects update | projects delete
  migration   provision | account
  settings    detail

sys
  login | logout | auth status | me
  curl        [method] <url-or-path> [curl-like options]

Compatibility aliases: curl, auth, mcu, mapping, patients, corporates, migration, settings.`

export const shortHelp = (): string => `micromeet <domain> <module> <function> [options]

Start here:
  micromeet crms login --region SG [--email user@example.com]
  micromeet crms auth status [--check] [--json]
  micromeet crms mcu records [--page 1] [--page-size 20] [--json]
  micromeet sys login [--email admin@example.com]
  micromeet sys auth status [--check] [--json]
  micromeet sys me [--json]

Discover commands:
  micromeet help <command-path>
  micromeet <command-path> help
  micromeet <command-path> --help
  micromeet modules
  micromeet manual
  micromeet --version

Global options:
  --base-url <url>
  --region <SG|HK|ID>
  --token <jwt>
  --workspace-id <id>
  --credential-file <path>
  --session-file <path>
  --json
  --debug`

export const helpForCommand = (path: string[]): string | undefined => {
  const normalizedPath = normalizeHelpPath(path)
  if (!normalizedPath.length) return shortHelp()
  const entry = helpEntries[normalizedPath.join(' ')]
  return entry ? formatHelpEntry(entry) : undefined
}
