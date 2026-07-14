const assert = require('assert/strict')
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('fs')
const { createCipheriv, randomBytes } = require('crypto')
const { createServer } = require('http')
const { tmpdir } = require('os')
const { join } = require('path')
const { spawn } = require('child_process')
const { credentialKeyFile, loadCredential, saveCredential } = require('../dist/credentialStore')

const cliEntry = join(__dirname, '..', 'dist', 'cli.js')

const readRequestBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

const runCliResult = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

const runCli = async (args, env) => {
  const result = await runCliResult(args, env)
  if (result.code !== 0) throw new Error(`CLI failed (${result.code}): ${result.stderr || result.stdout}`)
  return result
}

const main = async () => {
  const root = mkdtempSync(join(tmpdir(), 'micromeet-cli-auth-'))
  const directFile = join(root, 'direct', 'crms.json')
  const directPayload = {
    realm: 'crms',
    email: 'user@example.com',
    token: 'direct-secret-token',
    workspace_id: 'tenant-direct',
    region: 'SG',
    updated_at: 1
  }

  let server
  try {
    saveCredential(directFile, directPayload)
    const rawDirect = readFileSync(directFile, 'utf8')
    const directEnvelope = JSON.parse(rawDirect)
    const directKeyFile = credentialKeyFile(directFile)
    assert.equal(directEnvelope.version, 2)
    assert.equal(directEnvelope.key_storage, 'local-file-v2')
    assert(!rawDirect.includes(directPayload.token), 'credential file must not contain a plaintext token')
    assert.equal(readFileSync(directKeyFile).length, 32)
    assert.deepEqual(loadCredential(directFile, 'crms'), directPayload)
    if (process.platform !== 'win32') {
      assert.equal(statSync(directFile).mode & 0o777, 0o600)
      assert.equal(statSync(directKeyFile).mode & 0o777, 0o600)
      assert.equal(statSync(join(root, 'direct')).mode & 0o777, 0o700)
    }

    const tampered = JSON.parse(rawDirect)
    tampered.ciphertext = `${tampered.ciphertext[0] === 'A' ? 'B' : 'A'}${tampered.ciphertext.slice(1)}`
    writeFileSync(directFile, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 })
    assert.throws(() => loadCredential(directFile, 'crms'), /decryption failed/)

    // Embedded-runtime interoperability smoke: construct the exact v2 envelope
    // written by Cowork main, then read it through the bundled CLI store.
    const embeddedFile = join(root, 'embedded', 'crms.json')
    const embeddedKeyFile = credentialKeyFile(embeddedFile)
    const embeddedKey = randomBytes(32)
    const embeddedIv = randomBytes(12)
    const embeddedPayload = {
      realm: 'crms',
      email: 'embedded@example.com',
      token: 'embedded-secret-token',
      workspace_id: 'tenant-embedded',
      region: 'SG',
      auth_source: 'cowork',
      updated_at: 2
    }
    mkdirSync(join(root, 'embedded'), { recursive: true, mode: 0o700 })
    writeFileSync(embeddedKeyFile, embeddedKey, { mode: 0o600 })
    const embeddedCipher = createCipheriv('aes-256-gcm', embeddedKey, embeddedIv)
    embeddedCipher.setAAD(Buffer.from('micromeet-credential:v2:crms', 'utf8'))
    const embeddedCiphertext = Buffer.concat([
      embeddedCipher.update(JSON.stringify(embeddedPayload), 'utf8'),
      embeddedCipher.final()
    ])
    writeFileSync(
      embeddedFile,
      `${JSON.stringify({
        version: 2,
        realm: 'crms',
        algorithm: 'aes-256-gcm',
        key_storage: 'local-file-v2',
        iv: embeddedIv.toString('base64'),
        auth_tag: embeddedCipher.getAuthTag().toString('base64'),
        ciphertext: embeddedCiphertext.toString('base64')
      })}\n`,
      { mode: 0o600 }
    )
    assert.deepEqual(loadCredential(embeddedFile, 'crms'), embeddedPayload)

    server = createServer(async (request, response) => {
      const body = await readRequestBody(request)
      response.setHeader('Content-Type', 'application/json')
      if (request.method === 'POST' && request.url === '/share/auth/password-login') {
        assert.equal(body.email, 'crms@example.com')
        assert.equal(body.password, 'crms-password')
        response.end(
          JSON.stringify({
            jwt_token: 'crms-secret-token',
            tenant_id: 'tenant-1',
            role: 'staff',
            status: 'invited',
            must_set_password: true
          })
        )
        return
      }
      if (request.method === 'POST' && request.url === '/share/auth/set-password') {
        assert.equal(request.headers.authorization, 'Bearer crms-secret-token')
        assert.equal(body.password, 'activation-password')
        response.end(JSON.stringify({ set: true }))
        return
      }
      if (request.method === 'POST' && request.url === '/sys/auth/login') {
        assert.equal(body.email, 'sys@example.com')
        assert.equal(body.password, 'sys-password')
        response.end(JSON.stringify({ token: 'sys-secret-token', sysAdmin: { id: 'sys-1', email: body.email } }))
        return
      }
      if (request.method === 'GET' && request.url === '/sys/me') {
        assert.equal(request.headers.authorization, 'Bearer sys-secret-token')
        response.end(JSON.stringify({ id: 'sys-1', email: 'sys@example.com' }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ message: 'not found' }))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const home = join(root, 'home')
    const env = {
      HOME: home,
      USERPROFILE: home,
      MICROMEET_TOKEN: '',
      MICROMEET_SESSION_FILE: join(root, 'missing-session.json')
    }

    const legacyDir = join(home, '.micromeet')
    const legacyFile = join(legacyDir, 'session.json')
    const legacyToken = [
      Buffer.from('{"alg":"none"}').toString('base64url'),
      Buffer.from('{"email":"legacy@example.com"}').toString('base64url'),
      'signature'
    ].join('.')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(legacyFile, JSON.stringify({ jwt_token: legacyToken, tenant_id: 'legacy-tenant', region: 'HK' }))
    const legacyEnv = { ...env, MICROMEET_SESSION_FILE: legacyFile }
    const migratedStatus = await runCli(['crms', 'auth', 'status', '--json'], legacyEnv)
    assert.equal(JSON.parse(migratedStatus.stdout).token.source, 'credential')
    assert.equal(loadCredential(join(legacyDir, 'credentials', 'crms.json'), 'crms').token, legacyToken)
    assert.throws(() => readFileSync(legacyFile), /ENOENT/)

    const crmsLogin = await runCli(
      [
        'crms',
        'login',
        '--email',
        'crms@example.com',
        '--password',
        'crms-password',
        '--region',
        'ID',
        '--base-url',
        baseUrl,
        '--json'
      ],
      env
    )
    assert.equal(JSON.parse(crmsLogin.stdout).account.must_set_password, true)
    const crmsFile = join(home, '.micromeet', 'credentials', 'crms.json')
    const directLoginCredential = loadCredential(crmsFile, 'crms')
    assert.equal(directLoginCredential.region, 'ID')
    assert.equal(directLoginCredential.auth_source, 'cli')

    const missingRegion = await runCliResult(
      ['crms', 'login', '--email', 'crms@example.com', '--password', 'crms-password', '--base-url', baseUrl],
      env
    )
    assert.notEqual(missingRegion.code, 0)
    assert.match(missingRegion.stderr, /CRMS region is required in non-interactive mode/)

    const coworkCredential = {
      realm: 'crms',
      email: 'cowork@example.com',
      token: 'cowork-sg-token',
      workspace_id: 'tenant-cowork',
      region: 'SG',
      api_base_url: baseUrl,
      account: { id: 'cowork-user', role: 'owner' },
      auth_source: 'cowork',
      updated_at: 2
    }
    saveCredential(crmsFile, coworkCredential)
    assert.deepEqual(loadCredential(crmsFile, 'crms'), coworkCredential)
    const coworkStatus = JSON.parse((await runCli(['crms', 'auth', 'status', '--json'], env)).stdout)
    assert.equal(coworkStatus.region, 'SG')
    assert.equal(coworkStatus.credentialAuthSource, 'cowork')
    assert.equal(coworkStatus.workspaceId.value, 'tenant-cowork')

    await runCli(
      ['crms', 'login', '--email', 'crms@example.com', '--password', 'crms-password', '--json'],
      env
    )
    const inheritedRegionCredential = loadCredential(crmsFile, 'crms')
    assert.equal(inheritedRegionCredential.region, 'SG')
    assert.equal(inheritedRegionCredential.auth_source, 'cli')
    assert.equal(inheritedRegionCredential.token, 'crms-secret-token')
    assert.equal(inheritedRegionCredential.workspace_id, 'tenant-1')
    assert.equal(inheritedRegionCredential.account.must_set_password, true)

    const activation = await runCli(['crms', 'auth', 'set-password', '--json'], {
      ...env,
      MICROMEET_CRMS_PASSWORD: 'activation-password'
    })
    assert.equal(JSON.parse(activation.stdout).activated, true)
    await runCli(
      ['sys', 'login', '--email', 'sys@example.com', '--password', 'sys-password', '--base-url', baseUrl, '--json'],
      env
    )
    const sysFile = join(home, '.micromeet', 'credentials', 'sys.json')
    const crmsRaw = readFileSync(crmsFile, 'utf8')
    const sysRaw = readFileSync(sysFile, 'utf8')
    for (const secret of ['crms-secret-token', 'sys-secret-token', 'crms-password', 'activation-password', 'sys-password']) {
      assert(!crmsRaw.includes(secret) && !sysRaw.includes(secret), `credential files must not contain ${secret}`)
    }
    assert.equal(loadCredential(crmsFile, 'crms').token, 'crms-secret-token')
    assert.equal(loadCredential(sysFile, 'sys').token, 'sys-secret-token')

    const status = await runCli(['sys', 'auth', 'status', '--json'], env)
    const statusPayload = JSON.parse(status.stdout)
    assert.equal(statusPayload.token.present, true)
    assert.equal(statusPayload.token.source, 'credential')
    assert(!status.stdout.includes('sys-secret-token'))
    const me = await runCli(['sys', 'me', '--json'], env)
    assert.equal(JSON.parse(me.stdout).email, 'sys@example.com')

    console.log('[check-auth] ok')
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    try {
      chmodSync(directFile, 0o600)
    } catch {}
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
