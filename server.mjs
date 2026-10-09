import http from 'node:http'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { stat, readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createRequestHandler } from '@remix-run/node'

const production = process.env.NODE_ENV === 'production'
const vite = production ? null : await (await import('vite')).createServer({ server: { middlewareMode: true } })
const build = production ? await import('./build/server/index.js') : null
const clientRoot = resolve(production ? 'build/client' : 'public')
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

async function dispatch(req, res) {
  let overLimit = false
  try {
    const url = new URL(req.url || '/', process.env.SHOPIFY_APP_URL || `http://localhost:${process.env.PORT || 3000}`)
    const streamsFile = ['/api/upload/local', '/api/upload/bunny'].includes(url.pathname) && req.method === 'PUT'
    const bodyLimit = streamsFile ? 1024 ** 3 : 2 * 1024 ** 2
    if (Number(req.headers['content-length'] || 0) > bodyLimit) {
      res.statusCode = 413; res.setHeader('Connection', 'close'); res.end('Request too large'); return
    }
    if (['GET', 'HEAD'].includes(req.method || 'GET')) {
      const file = resolve(clientRoot, `.${decodeURIComponent(url.pathname)}`)
      if (file.startsWith(clientRoot + sep)) {
        const info = await stat(file).catch(() => null)
        if (info?.isFile()) {
          res.setHeader('Content-Type', contentTypes[extname(file)] || 'application/octet-stream')
          res.setHeader('Cache-Control', url.pathname.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'public,max-age=300')
          res.end(req.method === 'HEAD' ? undefined : await readFile(file)); return
        }
      }
    }
    const requestBuild = build || await vite.ssrLoadModule('virtual:remix/server-build')
    const headers = new Headers()
    for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1])
    const controller = new AbortController(); req.on('aborted', () => controller.abort())
    let received = 0
    const bounded = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > bodyLimit) { overLimit = true; callback(new Error('Public request body limit exceeded')) }
      else callback(null, chunk)
    } })
    bounded.on('error', () => controller.abort())
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) req.pipe(bounded)
    const request = new Request(url, { method: req.method, headers, signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(req.method || 'GET') ? { body: Readable.toWeb(bounded), duplex: 'half' } : {}) })
    const response = await requestBuild.entry.module.withTenantRequest(() =>
      createRequestHandler(requestBuild, production ? 'production' : 'development')(request))
    if (overLimit) { res.statusCode = 413; res.setHeader('Connection', 'close'); res.end('Request too large'); return }
    res.statusCode = response.status
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value) })
    const cookies = response.headers.getSetCookie?.() || []; if (cookies.length) res.setHeader('Set-Cookie', cookies)
    if (!response.body || req.method === 'HEAD') res.end(); else await pipeline(Readable.fromWeb(response.body), res)
  } catch (error) {
    console.error('Request dispatch failed', error instanceof Error ? error.name : 'unknown')
    if (!res.headersSent) { res.statusCode = overLimit ? 413 : 500; res.end(overLimit ? 'Request too large' : 'Request failed') } else res.destroy()
  }
}
const server = http.createServer((req, res) => vite ? vite.middlewares(req, res, () => void dispatch(req, res)) : void dispatch(req, res))
server.requestTimeout = 180_000; server.headersTimeout = 30_000
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Auto Gang Sheet Upload server ready'))
