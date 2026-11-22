const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('./db');

function kindOf(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.heic'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.aac', '.flac', '.m4a'].includes(ext)) return 'audio';
  return 'file';
}

// Why ffmpeg failed, in one line for the logs.
const reason = (err, stderr) => (String(stderr || '').trim().split('\n').pop() || (err.killed ? 'timed out' : err.message)).slice(0, 300);

// Generate a JPEG thumbnail (images) or poster frame (videos) with ffmpeg.
// srcPath is a local file or an http URL (ffmpeg reads only the bytes it needs from it).
// Resolves to the thumb filename, or null if ffmpeg is missing or fails (the reason is logged).
// ffmpeg can take hundreds of MB decoding a big photo or video, so only a couple run at once, however
// many files are being uploaded; the rest wait their turn instead of running the server out of memory.
const THUMB_SLOTS = Math.max(1, Number(process.env.THUMB_CONCURRENCY) || 2);
let busy = 0;
const waiting = [];
function inSlot(job) {
  return new Promise((resolve) => {
    const run = () => {
      busy++;
      job().then(resolve, (e) => { console.error(e.message); resolve(null); })
        .finally(() => { busy--; if (waiting.length) waiting.shift()(); });
    };
    busy < THUMB_SLOTS ? run() : waiting.push(run);
  });
}
function makeThumb(srcPath, kind, id) {
  if (kind !== 'image' && kind !== 'video') return Promise.resolve(null);
  return inSlot(() => runThumb(srcPath, kind, id).catch((e) => { throw new Error(`thumbnail failed for asset ${id}: ${e.message}`); }));
}

// A screen-sized JPEG of a photo (longest side 2560 px) for the client gallery's big view and cover.
// Photographers deliver huge originals (a 50 MB PNG or TIFF is normal); showing those in the browser
// means downloading every one in full just to look at it. The original stays untouched for downloads.
// Resolves to the file name in DATA_DIR/thumbs, or null when ffmpeg fails.
const VIEW_EDGE = 2560;
function makeView(srcPath, id) {
  return inSlot(() => new Promise((resolve) => {
    const out = `${id}-v.jpg`;
    const outPath = path.join(DATA_DIR, 'thumbs', out);
    const fit = `scale='if(gte(iw,ih),min(${VIEW_EDGE},iw),-2)':'if(gte(iw,ih),-2,min(${VIEW_EDGE},ih))'`;
    const args = ['-y', '-loglevel', 'error', ...safeInput(srcPath), '-i', srcPath, '-frames:v', '1', '-vf', fit, '-q:v', '3', outPath];
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: /^https?:/.test(srcPath) ? 180000 : 90000 }, (err, so, stderr) => {
      if (!err && fs.existsSync(outPath)) return resolve(out);
      console.error(`view image failed for asset ${id}: ${reason(err || {}, stderr)}`);
      fs.rm(outPath, { force: true }, () => {});
      resolve(null);
    });
  }));
}

const FORMATS = 'mov,matroska,avi,mpegts,flv,mxf,mpeg,mjpeg,gif,image2,png_pipe,jpeg_pipe,webp_pipe,tiff_pipe,bmp_pipe,jpegxl_pipe,heif';

// Input options for an untrusted file: see runThumb.
const safeInput = (src) => ['-protocol_whitelist', src === 'pipe:0' ? 'pipe' : /^https?:/.test(src) ? 'http,tcp' : 'file', '-format_whitelist', FORMATS];

function runThumb(srcPath, kind, id) {
  const out = `${id}.jpg`;
  const outPath = path.join(DATA_DIR, 'thumbs', out);
  const args = ['-y', '-loglevel', 'error'];
  // Uploaded files are untrusted. Only plain photo and video formats may be opened, and only the one
  // file (or the loopback relay) itself: no playlists or file lists that point ffmpeg at other files
  // on this server or at other addresses.
  args.push(...safeInput(srcPath));
  if (kind === 'video') args.push('-ss', '1');
  args.push('-i', srcPath, '-frames:v', '1', '-vf', "scale='min(1200,iw)':-2", '-q:v', '4', outPath);
  const opts = { timeout: /^https?:/.test(srcPath) ? 120000 : 60000 };
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  return new Promise((resolve) => {
    execFile(ffmpeg, args, opts, (err, so, stderr) => {
      if (!err && fs.existsSync(outPath)) return resolve(out);
      if (kind !== 'video') { console.error(`thumbnail failed for asset ${id}: ${reason(err || {}, stderr)}`); return resolve(null); }
      // Very short clips: retry from the first frame.
      const retry = args.filter((a, i) => !(a === '-ss' || args[i - 1] === '-ss'));
      execFile(ffmpeg, retry, opts, (e2, so2, stderr2) => {
        if (!e2 && fs.existsSync(outPath)) return resolve(out);
        console.error(`thumbnail failed for asset ${id}: ${reason(e2 || {}, stderr2 || stderr)}`);
        resolve(null);
      });
    });
  });
}

// Width / height of a thumbnail, read from its JPEG header, so the client gallery can lay each photo
// or film out at its real shape (a vertical shot stays vertical instead of being cropped to a wide tile).
// Thumbnails never change once made, so the answer is remembered per file.
const ratios = new Map();
function thumbRatio(thumbName) {
  if (!thumbName) return null;
  if (ratios.has(thumbName)) return ratios.get(thumbName);
  let r = null;
  try {
    const fd = fs.openSync(path.join(DATA_DIR, 'thumbs', thumbName), 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    let i = 2;
    while (i + 9 < n && buf[0] === 0xff && buf[1] === 0xd8) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      // SOF0..SOF15 (not DHT C4, JPG C8 or DAC CC) carry the frame size.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = buf.readUInt16BE(i + 5), w = buf.readUInt16BE(i + 7);
        if (w && h) r = Math.round((w / h) * 1000) / 1000;
        break;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch (e) { return null; } // not made yet or missing: don't remember, it may appear later
  ratios.set(thumbName, r);
  return r;
}

// A profile photo or header photo, re-encoded as a JPEG at a sensible size: the avatar cropped to a
// centred square, the header kept wide. Re-encoding also drops whatever else was in the file (EXIF,
// location). Resolves to the JPEG bytes, or null when ffmpeg can't read the image.
const PHOTO_FILTERS = {
  avatar: "crop='min(iw,ih)':'min(iw,ih)',scale=640:640",
  header: "scale='min(2400,iw)':-2",
};
function squashPhoto(buf, mode) {
  return new Promise((resolve) => {
    const child = execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...safeInput('pipe:0'), '-i', 'pipe:0', '-vf', PHOTO_FILTERS[mode],
      '-frames:v', '1', '-q:v', '3', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err || !stdout.length) { console.error(`photo resize failed: ${err ? reason(err, stderr) : 'no output'}`); return resolve(null); }
      resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  });
}

module.exports = { kindOf, makeThumb, makeView, thumbRatio, squashPhoto };
