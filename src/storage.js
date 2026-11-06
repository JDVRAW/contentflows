// Object storage (Cloudflare R2 or any S3-compatible service) for uploaded files.
// When S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are set, browsers upload
// straight to the bucket in parts (multipart upload with presigned URLs), so big videos never pass
// through this server. Clients stream and download through short-lived signed links.
// Without those variables, files stay on the local disk as before.
const {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Values pasted into a host's settings often carry stray spaces or quotes.
const val = (k) => String(process.env[k] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const REQUIRED = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const missing = REQUIRED.filter((k) => !val(k));
const enabled = missing.length === 0;
const Bucket = enabled ? val('S3_BUCKET') : null;
// Cloudflare shows the bucket's S3 address with the bucket name on the end; only the host part is needed.
const endpoint = enabled ? new URL(/^https?:\/\//.test(val('S3_ENDPOINT')) ? val('S3_ENDPOINT') : `https://${val('S3_ENDPOINT')}`).origin : null;
const describe = enabled ? `bucket "${Bucket}" at ${new URL(endpoint).host}` : `local disk (missing ${missing.join(', ')})`;
const client = enabled ? new S3Client({
  region: val('S3_REGION') || 'auto',
  endpoint,
  forcePathStyle: val('S3_FORCE_PATH_STYLE') === '1',
  // Without these, newer SDKs add checksum parameters to signed URLs that a browser PUT can't satisfy.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: val('S3_ACCESS_KEY_ID'), secretAccessKey: val('S3_SECRET_ACCESS_KEY') },
}) : null;

const MiB = 1024 * 1024;
// Parts must be at least 5 MiB and all the same size except the last; S3 allows 10,000 parts.
const partSizeFor = (size) => Math.max(16 * MiB, Math.ceil(size / 9000 / MiB) * MiB);

async function startUpload(Key, ContentType) {
  const r = await client.send(new CreateMultipartUploadCommand({ Bucket, Key, ContentType: ContentType || 'application/octet-stream' }));
  return r.UploadId;
}

function signParts(Key, UploadId, partNumbers) {
  return Promise.all(partNumbers.map(async (PartNumber) =>
    [PartNumber, await getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn: 3600 })]))
    .then(Object.fromEntries);
}

async function completeUpload(Key, UploadId, parts) {
  const Parts = parts.map((p) => ({ PartNumber: +p.PartNumber, ETag: String(p.ETag) })).sort((a, b) => a.PartNumber - b.PartNumber);
  await client.send(new CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts } }));
  const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
  return head.ContentLength;
}

const abortUpload = (Key, UploadId) => client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => {});

// Content-Disposition with a UTF-8 file name (RFC 6266), safe for any characters.
const disposition = (type, name) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

function signedGet(Key, { name, contentType, attachment = false, expiresIn = 6 * 3600 } = {}) {
  return getSignedUrl(client, new GetObjectCommand({
    Bucket, Key,
    ResponseContentType: contentType || undefined,
    ResponseContentDisposition: name ? disposition(attachment ? 'attachment' : 'inline', name) : undefined,
  }), { expiresIn });
}

// One byte range of an object (for the local relay ffmpeg reads thumbnails through).
const getRange = (Key, Range) => client.send(new GetObjectCommand({ Bucket, Key, Range: Range || undefined }));

async function getStream(Key) {
  const r = await client.send(new GetObjectCommand({ Bucket, Key }));
  return r.Body;
}

const remove = (Key) => client.send(new DeleteObjectCommand({ Bucket, Key })).catch((e) => console.error('storage remove', Key, e.message));

// Some S3 variables set but not all: almost always a setup slip worth pointing out.
const partlySet = missing.length > 0 && missing.length < REQUIRED.length ? missing : null;

module.exports = { enabled, describe, partlySet, partSizeFor, startUpload, signParts, completeUpload, abortUpload, signedGet, getRange, getStream, remove };
