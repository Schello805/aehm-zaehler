import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

for (const password of ['', 'test-only-random-password-12345']) {
test(`API session ownership, polling and admin configuration (${password ? 'configured' : 'disabled'})`, { timeout: 20000 }, async () => {
  const port = 20000 + Math.floor(Math.random() * 30000)
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), ADMIN_DELETE_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('Testserver konnte nicht starten.') }),
    ])
    server.stdout.resume()
    server.stderr.resume()
    const base = `http://127.0.0.1:${port}`
    const admin = await fetch(`${base}/api/admin/verify-delete-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password || 'test' }),
    })
    assert.equal(admin.status, password ? 200 : 503)
    if (password) {
      for (const [index, expectedStatus] of [401, 401, 403, 429].entries()) {
        const failed = await fetch(`${base}/api/admin/verify-delete-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${index + 1}` },
          body: JSON.stringify({ password: 'incorrect' }),
        })
        assert.equal(failed.status, expectedStatus, 'Changing forwarded headers must not bypass lockout')
      }
    }

    const form = new FormData()
    const id = crypto.randomUUID()
    form.set('jobId', id)
    form.set('words', '[]')
    form.set('url', 'http://127.0.0.1/private')
    const created = await fetch(`${base}/api/analyze`, { method: 'POST', body: form })
    const cookie = created.headers.get('set-cookie').split(';')[0]
    assert.match(await created.text(), /nicht erlaubte URL/)

    const own = await fetch(`${base}/api/analyze-status/${id}`, { headers: { cookie } })
    assert.equal(own.status, 200)
    const state = await own.json()
    assert.equal(state.owner, undefined)
    assert.equal(state.audioPath, undefined)

    for (const path of ['analyze-status', 'analyze-result', 'audio-stream', 'analyze-cancel']) {
      const response = await fetch(`${base}/api/${path}/${id}`, { method: path === 'analyze-cancel' ? 'POST' : 'GET' })
      assert.equal(response.status, 404, path)
      await response.body.cancel()
    }
    for (let i = 0; i < 130; i++) {
      const response = await fetch(`${base}/api/analyze-status/${id}`, { headers: { cookie } })
      assert.equal(response.status, 200)
      await response.body.cancel()
    }
  } finally {
    server.kill('SIGTERM')
    await once(server, 'exit')
  }
})
}
