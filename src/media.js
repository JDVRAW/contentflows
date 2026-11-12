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
function makeThumb(srcPath, kind, id) {
  if (kind !== 'image' && kind !== 'video') return Promise.resolve(null);
  return new Promise((resolve) => {
    const run = () => {
      busy++;
      runThumb(srcPath, kind, id).then(resolve, (e) => { console.error(`thumbnail failed for asset ${id}: ${e.message}`); resolve(null); })
        .finally(() => { busy--; if (waiting.length) waiting.shift()(); });
    };
    busy < THUMB_SLOTS ? run() : waiting.push(run);
  });
}

function runThumb(srcPath, kind, id) {
  const out = `${id}.jpg`;
  const outPath = path.join(DATA_DIR, 'thumbs', out);
  const args = ['-y', '-loglevel', 'error'];
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

module.exports = { kindOf, makeThumb };
