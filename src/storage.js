// Object storage (Amazon S3, Cloudflare R2 or any S3-compatible service) for uploaded files.
// When S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_REGION (Amazon) or S3_ENDPOINT (others) are set, browsers upload
// straight to the bucket in parts (multipart upload with presigned URLs), so big videos never pass
// through this server. Clients stream and download through short-lived signed links.
// Without those variables, files stay on the local disk as before.
const {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectCommand,
} = require('@aws-sdk/client-s3');
const fs = require('fs');
const crypto = require('crypto');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Values pasted into a host's settings often carry stray spaces or quotes.
const val = (k) => String(process.env[k] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
// Amazon S3 needs a region and no address (the SDK knows it); R2 and others need an address.
const awsRegion = (host) => (host.match(/^(?:[^.]+\.)?s3[.-]([a-z0-9-]+)\.amazonaws\.com$/) || [])[1] || null;
const rawEndpoint = val('S3_ENDPOINT');
const endpointUrl = rawEndpoint ? new URL(/^https?:\/\//.test(rawEndpoint) ? rawEndpoint : `https://${rawEndpoint}`) : null;
const isAws = endpointUrl ? /(^|\.)amazonaws\.com$/.test(endpointUrl.hostname) : !!val('S3_REGION') && val('S3_REGION') !== 'auto';
const region = (val('S3_REGION') && val('S3_REGION') !== 'auto' ? val('S3_REGION') : null)
  || (endpointUrl && awsRegion(endpointUrl.hostname)) || (isAws ? 'us-east-1' : 'auto');
const REQUIRED = [isAws ? 'S3_REGION' : 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const missing = REQUIRED.filter((k) => !val(k) && !(k === 'S3_REGION' && endpointUrl));
const enabled = missing.length === 0;
const Bucket = enabled ? val('S3_BUCKET') : null;
// Cloudflare shows the bucket's S3 address with the bucket name on the end; only the host part is needed.
const endpoint = enabled && !isAws ? endpointUrl.origin : null;
const describe = enabled ? `bucket "${Bucket}" at ${isAws ? `Amazon S3 (${region})` : new URL(endpoint).host}` : `local disk (missing ${missing.join(', ')})`;
const client = enabled ? new S3Client({
  region,
  ...(endpoint ? { endpoint } : {}),
  forcePathStyle: val('S3_FORCE_PATH_STYLE') === '1',
  // Without these, newer SDKs add checksum parameters to signed URLs that a browser PUT can't satisfy.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: val('S3_ACCESS_KEY_ID'), secretAccessKey: val('S3_SECRET_ACCESS_KEY') },
}) : null;

// Optional: clients download through Amazon CloudFront instead of straight from the bucket. Downloads
// straight from S3 are billed per GB; CloudFront's free tier covers the first 1 TB a month. Needs the
// distribution's address, the ID of a public key in a trusted key group, and that key's private half.
const cf = {
  domain: val('CLOUDFRONT_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  keyPairId: val('CLOUDFRONT_KEY_PAIR_ID'),
  // Hosts' settings often keep a PEM on one line with literal \n.
  privateKey: val('CLOUDFRONT_PRIVATE_KEY').replace(/\\n/g, '\n'),
};
const cdn = enabled && !!(cf.domain && cf.keyPairId && cf.privateKey);
const cdnPartlySet = !cdn && [cf.domain, cf.keyPairId, cf.privateKey].some(Boolean);

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

// One part of a multipart upload, streamed straight from a request (Body) of a known length.
async function putPart(Key, UploadId, PartNumber, Body, ContentLength) {
  const r = await client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ContentLength, Body }));
  return r.ETag;
}

const abortUpload = (Key, UploadId) => client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => {});

// Upload a file from this server's disk (files an assistant adds by link land here first).
// Small files go in one request; bigger ones in parts, read straight from the file.
async function putFile(Key, file, ContentType) {
  const size = fs.statSync(file).size;
  ContentType = ContentType || 'application/octet-stream';
  if (size <= 64 * MiB) {
    await client.send(new PutObjectCommand({ Bucket, Key, ContentType, ContentLength: size, Body: fs.createReadStream(file) }));
    return size;
  }
  const UploadId = await startUpload(Key, ContentType);
  try {
    const step = partSizeFor(size);
    const parts = [];
    for (let start = 0, PartNumber = 1; start < size; start += step, PartNumber++) {
      const end = Math.min(size, start + step);
      const r = await client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ContentLength: end - start,
        Body: fs.createReadStream(file, { start, end: end - 1 }) }));
      parts.push({ PartNumber, ETag: r.ETag });
    }
    return await completeUpload(Key, UploadId, parts);
  } catch (e) {
    await abortUpload(Key, UploadId);
    throw e;
  }
}

// Upload from a stream of unknown or known length (a file being copied in from a link, the Vault or
// Google Drive), without writing it to this server's disk: the stream is cut into parts held in
// memory one at a time and each part goes to the bucket before more is read. sizeHint (the expected
// size, or the most it may be) picks the part size so even the biggest file fits in 10,000 parts.
// A file smaller than one part goes in a single request. Resolves to the stored size.
async function putStream(Key, stream, ContentType, sizeHint) {
  ContentType = ContentType || 'application/octet-stream';
  const step = partSizeFor(sizeHint || 0);
  let buf = [], held = 0, UploadId = null, PartNumber = 0, total = 0;
  const parts = [];
  const flush = async () => {
    const Body = Buffer.concat(buf, held);
    buf = []; held = 0;
    if (!UploadId) UploadId = await startUpload(Key, ContentType);
    PartNumber++;
    const r = await client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ContentLength: Body.length, Body }));
    parts.push({ PartNumber, ETag: r.ETag });
  };
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      // Keep every part exactly one step long (S3 wants equal parts but the last).
      let c = chunk;
      while (held + c.length >= step) {
        const take = step - held;
        buf.push(c.subarray(0, take)); held += take;
        c = c.subarray(take);
        await flush();
      }
      if (c.length) { buf.push(c); held += c.length; }
    }
    if (!UploadId) {
      const Body = Buffer.concat(buf, held);
      await client.send(new PutObjectCommand({ Bucket, Key, ContentType, ContentLength: Body.length, Body }));
      return total;
    }
    if (held) await flush();
    await completeUpload(Key, UploadId, parts);
    return total;
  } catch (e) {
    if (UploadId) await abortUpload(Key, UploadId);
    throw e;
  }
}

// Content-Disposition with a UTF-8 file name (RFC 6266), safe for any characters.
const disposition = (type, name) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// CloudFront's URL-safe base64 for signatures and policies.
const cfBase64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');

// A CloudFront signed link (canned policy) for one object. The response-* parameters pass through to
// S3, so the file name and type work as with S3 links; the distribution has to forward them.
function cloudfrontGet(Key, { name, contentType, attachment, expiresIn }) {
  const q = new URLSearchParams();
  if (name) q.set('response-content-disposition', disposition(attachment ? 'attachment' : 'inline', name));
  if (contentType) q.set('response-content-type', contentType);
  const path = Key.split('/').map(encodeURIComponent).join('/');
  const qs = q.toString().replace(/\+/g, '%20');
  const url = `https://${cf.domain}/${path}${qs ? `?${qs}` : ''}`;
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expires } } }] });
  const signature = cfBase64(crypto.createSign('RSA-SHA1').update(policy).sign(cf.privateKey));
  return `${url}${qs ? '&' : '?'}Expires=${expires}&Signature=${signature}&Key-Pair-Id=${encodeURIComponent(cf.keyPairId)}`;
}

async function signedGet(Key, { name, contentType, attachment = false, expiresIn = 6 * 3600 } = {}) {
  if (cdn) return cloudfrontGet(Key, { name, contentType, attachment, expiresIn });
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

module.exports = { enabled, describe, partlySet, cdn, cdnPartlySet, Bucket, client, partSizeFor, startUpload, signParts, completeUpload, abortUpload, putPart, signedGet, getRange, getStream, remove, disposition, putFile, putStream };
