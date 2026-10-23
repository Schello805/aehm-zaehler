import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('const isBlockedIpAddress'), source.indexOf('// Result Cache'))

function securityContext({ addresses = [{ address: '93.184.216.34', family: 4 }], responses = [] } = {}) {
  const requests = []
  const context = vm.createContext({
    URL, AbortSignal, ipaddr, isIP,
    lookup: async () => addresses,
    Agent: class { constructor(options) { this.options = options } },
    fetch: async (url, options) => {
      requests.push({ url, options })
      return responses.shift() || { status: 200 }
    },
  })
  vm.runInContext(`${helpers}\nglobalThis.security = { isValidHttpUrl, assertSafeRemoteUrl, fetchSafe, safeDispatcher }`, context)
  return { ...context.security, requests }
}

test('rejects internal IPs, mapped IPv6, credentials, non-HTTP and unusual ports', () => {
  const { isValidHttpUrl } = securityContext()
  for (const url of [
    'http://127.1', 'http://2130706433', 'http://0x7f000001',
    'http://10.0.0.1', 'http://100.64.0.1', 'http://169.254.169.254',
    'http://192.168.1.1', 'http://172.16.0.1', 'http://[::1]',
    'http://[::ffff:7f00:1]', 'http://[fd00::1]', 'http://[fe80::1]',
    'http://[2002:7f00:1::]', 'http://localhost', 'http://service.internal',
    'file:///etc/passwd', 'http://user:password@example.com', 'https://example.com:8080',
  ]) assert.equal(isValidHttpUrl(url), false, url)
  assert.equal(isValidHttpUrl('https://www.youtube.com/watch?v=example'), true)
})

test('rejects hostnames with any internal DNS answer', async () => {
  const { assertSafeRemoteUrl } = securityContext({ addresses: [
    { address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 },
  ] })
  await assert.rejects(assertSafeRemoteUrl('https://example.com'))
})

test('validates every redirect and never fetches an internal destination', async () => {
  const { fetchSafe, requests } = securityContext({ responses: [
    { status: 302, headers: new Headers({ location: 'http://127.0.0.1/private' }), body: { cancel: async () => {} } },
  ] })
  await assert.rejects(fetchSafe('https://example.com'))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.redirect, 'manual')
})

test('connection DNS lookup rejects rebinding to an internal address', async () => {
  const { safeDispatcher } = securityContext({ addresses: [{ address: '127.0.0.1', family: 4 }] })
  await assert.rejects(new Promise((resolve, reject) => {
    safeDispatcher.options.connect.lookup('example.com', {}, (error, value) => error ? reject(error) : resolve(value))
  }))
})

test('normal public DNS lookup works for ordinary and all-address socket modes', async () => {
  const { safeDispatcher } = securityContext()
  for (const all of [false, true]) {
    const value = await new Promise((resolve, reject) => {
      safeDispatcher.options.connect.lookup('example.com', { all }, (error, result) => error ? reject(error) : resolve(result))
    })
    assert.equal(all ? value[0].address : value, '93.184.216.34')
  }
})
