import type { LoaderFunctionArgs } from '@remix-run/node'
import { readFile } from 'fs/promises'
import { join, basename, extname } from 'path'













const ALLOWED_EXTENSIONS = new Set(['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.woff', '.woff2'])

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export async function loader({ params, request }: LoaderFunctionArgs) {

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const filename = params['*']
  if (!filename) {
    return new Response('Not found', { status: 404 })
  }


  const safe = basename(filename)
  if (safe !== filename || filename.includes('..')) {
    return new Response('Forbidden', { status: 403 })
  }


  const ext = extname(safe).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return new Response('Forbidden file type', { status: 403 })
  }


  const assetsDir = join(process.cwd(), 'extensions', 'theme-extension', 'assets')
  const filePath = join(assetsDir, safe)

  try {
    const buffer = await readFile(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': process.env.NODE_ENV === 'production'
          ? 'public, max-age=3600, s-maxage=86400'
          : 'no-cache',
        'Content-Length': String(buffer.length),
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[ExtAssets] File not found:', safe, error)
    return new Response('Not found', { status: 404 })
  }
}
