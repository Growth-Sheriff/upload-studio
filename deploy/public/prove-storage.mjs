// Opt-in disposable evidence against only the new public bucket. Never logs signed URLs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { validateStoredRasterHeader } = await import('/app/app/lib/storedRasterHeader.server.ts');
assert.equal(process.env.SHOPIFY_API_KEY, '8822c01b1f0be2280240cfab7d4e9a79');
assert.equal(process.env.R2_ACCOUNT_ID, '3b964e63af3f0e752c640e35dab68c9b');
assert.equal(process.env.R2_BUCKET_NAME, 'auto-gang-sheet-public');
assert.equal(process.env.PUBLIC_APP_RUNTIME, 'true');
assert.equal(process.env.R2_PUBLIC_URL || '', '');
const Bucket = process.env.R2_BUCKET_NAME;
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const Key = `release-proof/${randomUUID()}/header.png`;
const Origin = 'https://auto-gang-sheet-demo.myshopify.com';
const evidence = { startedAt: new Date().toISOString(), bucket: Bucket, checks: [] };
let multipartId;
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(300); ihdr.writeUInt32BE(600, 4); ihdr[8] = 8; ihdr[9] = 6;
const phys = Buffer.alloc(9); phys.writeUInt32BE(11811); phys.writeUInt32BE(11811, 4); phys[8] = 1;
const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', deflateSync(Buffer.alloc(600 * (1 + 300 * 4)))), chunk('tEXt', Buffer.concat([Buffer.from('proof\0'), Buffer.alloc(70000, 65)])), chunk('IEND', Buffer.alloc(0))]);
try {
  const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType: 'image/png', ContentLength: bytes.length }), { expiresIn: 60 });
  const started = performance.now();
  const put = await fetch(putUrl, { method: 'PUT', headers: { Origin, 'Content-Type': 'image/png' }, body: bytes });
  assert.equal(put.status, 200); assert.equal(put.headers.get('access-control-allow-origin'), '*'); assert.ok(put.headers.get('etag'));
  evidence.checks.push({ name: 'signed PUT + CORS + exposed ETag', status: put.status, durationMs: Math.round(performance.now() - started), bytes: bytes.length });
  const head = await client.send(new HeadObjectCommand({ Bucket, Key })); assert.equal(head.ContentLength, bytes.length);
  const range = await client.send(new GetObjectCommand({ Bucket, Key, Range: 'bytes=0-65535' }));
  const prefix = await range.Body.transformToByteArray(); assert.equal(prefix.length, 65536); assert.equal(range.$metadata.httpStatusCode, 206);
  evidence.checks.push({ name: 'stored 64KiB range', status: 206, returnedBytes: prefix.length, contentRange: range.ContentRange });
  const storageConfig = { provider: 'r2', r2AccountId: process.env.R2_ACCOUNT_ID, r2BucketName: Bucket };
  const config = { maxFileSizeMB: 1024, minDPI: 150, requiredDPI: 300, maxPages: 1, allowedFormats: ['image/png', 'image/jpeg'], requireTransparency: false, measurementBasis: 'full_page', maxPrintableWidthIn: 22.5, fitToleranceIn: 0.02 };
  const measurementStart = performance.now();
  const projection = await validateStoredRasterHeader({ storageConfig, storageKey: `r2:${Key}`, fileSize: bytes.length, config, clientProbe: { widthPx: 1, heightPx: 2, dpi: 9999 } });
  assert.equal(projection.kind, 'ready'); assert.equal(projection.metadata.widthPx, 300); assert.equal(projection.metadata.heightPx, 600); assert.equal(projection.preflightResult.headerValidation.pixelDimensionsMatched, false);
  evidence.checks.push({ name: 'real R2 validator overrides tampered browser facts', widthPx: 300, heightPx: 600, durationMs: Math.round(performance.now() - measurementStart) });
  const anonymous = await fetch(`${endpoint}/${Bucket}/${Key}`);
  const anonymousCode = (await anonymous.text()).match(/<Code>([^<]+)<\/Code>/)?.[1];
  assert.ok([400,401,403,404].includes(anonymous.status), `Unexpected anonymous status ${anonymous.status}`);
  assert.ok(['InvalidArgument','AccessDenied','Unauthorized','AuthorizationQueryParametersError','NoSuchKey'].includes(anonymousCode), `Unexpected anonymous error ${anonymousCode}`);
  evidence.checks.push({ name: 'unsigned read denied', status: anonymous.status, providerCode: anonymousCode });
  const multipart = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: `${Key}.partial`, ContentType: 'image/png' }));
  multipartId = multipart.UploadId; assert.ok(multipartId);
  await client.send(new AbortMultipartUploadCommand({ Bucket, Key: `${Key}.partial`, UploadId: multipartId })); multipartId = undefined;
  const remaining = await client.send(new ListMultipartUploadsCommand({ Bucket, Prefix: `${Key}.partial` })); assert.equal(remaining.Uploads?.length || 0, 0);
  evidence.checks.push({ name: 'multipart create + abort confirmed', remaining: 0 });
  const missing = await validateStoredRasterHeader({ storageConfig, storageKey: `r2:${Key}.missing`, fileSize: bytes.length, config });
  assert.equal(missing.kind, 'blocked'); assert.equal(missing.preflightResult.capabilities.canAddToCart, false);
  evidence.checks.push({ name: 'missing object not orderable', kind: missing.kind });
} finally {
  if (multipartId) await client.send(new AbortMultipartUploadCommand({ Bucket, Key: `${Key}.partial`, UploadId: multipartId }));
  await client.send(new DeleteObjectCommand({ Bucket, Key }));
  await assert.rejects(client.send(new HeadObjectCommand({ Bucket, Key })), error => error.$metadata?.httpStatusCode === 404);
  evidence.cleanup = 'Exact generated object removed and HEAD404 verified; no database/queue/order/fee rows created.';
  client.destroy();
}
evidence.completedAt = new Date().toISOString();
console.log(JSON.stringify(evidence, null, 2));
