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

const env = process.env;
const enabled = !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
const Bucket = enabled ? env.S3_BUCKET.trim() : null;
// Cloudflare shows the bucket's S3 address with the bucket name on the end; only the host part is needed.
const endpoint = enabled ? new URL(/^https?:\/\//.test(env.S3_ENDPOINT.trim()) ? env.S3_ENDPOINT.trim() : `https://${env.S3_ENDPOINT.trim()}`).origin : null;
const client = enabled ? new S3Client({
  region: env.S3_REGION || 'auto',
  endpoint,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === '1',
  // Without these, newer SDKs add checksum parameters to signed URLs that a browser PUT can't satisfy.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID.trim(), secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim() },
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

async function getStream(Key) {
  const r = await client.send(new GetObjectCommand({ Bucket, Key }));
  return r.Body;
}

const remove = (Key) => client.send(new DeleteObjectCommand({ Bucket, Key })).catch((e) => console.error('storage remove', Key, e.message));

module.exports = { enabled, partSizeFor, startUpload, signParts, completeUpload, abortUpload, signedGet, getStream, remove };
