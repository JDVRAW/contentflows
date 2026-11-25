// Copies every file from the old bucket (e.g. Cloudflare R2) to the bucket set in S3_* (e.g. Amazon S3),
// under the same names, so the database needs no change. Safe to run again: files already in the new
// bucket with the same size are skipped, so a second run just after the switch picks up the last uploads.
//
//   FROM_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com FROM_S3_BUCKET=contentflows \
//   FROM_S3_ACCESS_KEY_ID=... FROM_S3_SECRET_ACCESS_KEY=... \
//   S3_REGION=us-east-1 S3_BUCKET=contentflows-files S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
//   node scripts/copy-to-s3.js [--dry-run]
//
// Nothing is written to this computer's disk: each file streams from one bucket to the other.
const { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const storage = require('../src/storage');

const val = (k) => String(process.env[k] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const dryRun = process.argv.includes('--dry-run');
const CONCURRENCY = Math.max(1, +val('COPY_CONCURRENCY') || 4);

function fail(msg) { console.error(msg); process.exit(1); }
const need = ['FROM_S3_ENDPOINT', 'FROM_S3_BUCKET', 'FROM_S3_ACCESS_KEY_ID', 'FROM_S3_SECRET_ACCESS_KEY'].filter((k) => !val(k));
if (need.length) fail(`Missing ${need.join(', ')} (the old bucket).`);
if (!storage.enabled) fail(`The new bucket is not set up: ${storage.describe}.`);

const fromEndpoint = val('FROM_S3_ENDPOINT');
const from = new S3Client({
  region: val('FROM_S3_REGION') || 'auto',
  forcePathStyle: val('FROM_S3_FORCE_PATH_STYLE') === '1',
  endpoint: new URL(/^https?:\/\//.test(fromEndpoint) ? fromEndpoint : `https://${fromEndpoint}`).origin,
  credentials: { accessKeyId: val('FROM_S3_ACCESS_KEY_ID'), secretAccessKey: val('FROM_S3_SECRET_ACCESS_KEY') },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
const FromBucket = val('FROM_S3_BUCKET');

async function* listAll() {
  let ContinuationToken;
  do {
    const r = await from.send(new ListObjectsV2Command({ Bucket: FromBucket, ContinuationToken }));
    for (const o of r.Contents || []) yield o;
    ContinuationToken = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (ContinuationToken);
}

async function sizeInNewBucket(Key) {
  try { return (await storage.client.send(new HeadObjectCommand({ Bucket: storage.Bucket, Key }))).ContentLength; }
  catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return null; throw e; }
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;

(async () => {
  console.log(`From bucket "${FromBucket}" at ${new URL(/^https?:\/\//.test(fromEndpoint) ? fromEndpoint : `https://${fromEndpoint}`).host}`);
  console.log(`To ${storage.describe}${dryRun ? ' (dry run: nothing is copied)' : ''}`);
  const stats = { copied: 0, skipped: 0, failed: 0, bytes: 0, total: 0 };
  const failed = [];
  const queue = [];
  const work = async (o) => {
    stats.total++;
    const have = await sizeInNewBucket(o.Key);
    if (have === o.Size) { stats.skipped++; return; }
    if (dryRun) { stats.copied++; stats.bytes += o.Size; console.log(`would copy ${o.Key} (${gb(o.Size)})`); return; }
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await from.send(new GetObjectCommand({ Bucket: FromBucket, Key: o.Key }));
        const n = await storage.putStream(o.Key, r.Body, r.ContentType, o.Size);
        if (n !== o.Size) throw new Error(`size ${n} instead of ${o.Size}`);
        stats.copied++; stats.bytes += o.Size;
        console.log(`ok ${o.Key} (${gb(o.Size)})`);
        return;
      } catch (e) {
        if (attempt >= 3) { stats.failed++; failed.push(o.Key); console.error(`FAILED ${o.Key}: ${e.message}`); return; }
        await new Promise((res) => setTimeout(res, 2000 * attempt));
      }
    }
  };
  for await (const o of listAll()) {
    if (o.Key.endsWith('/')) continue;
    const p = work(o).finally(() => queue.splice(queue.indexOf(p), 1));
    queue.push(p);
    if (queue.length >= CONCURRENCY) await Promise.race(queue);
  }
  await Promise.all(queue);
  console.log(`\n${stats.total} files: ${stats.copied} ${dryRun ? 'to copy' : 'copied'} (${gb(stats.bytes)}), ${stats.skipped} already there, ${stats.failed} failed`);
  if (failed.length) { console.log('Run the script again to retry the failed files.'); process.exit(1); }
})().catch((e) => fail(`Stopped: ${e.message}`));
