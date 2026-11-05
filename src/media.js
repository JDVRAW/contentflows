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

// Generate a JPEG thumbnail (images) or poster frame (videos) with ffmpeg.
// Resolves to the thumb filename, or null if ffmpeg is missing or fails.
function makeThumb(srcPath, kind, id) {
  if (kind !== 'image' && kind !== 'video') return Promise.resolve(null);
  const out = `${id}.jpg`;
  const outPath = path.join(DATA_DIR, 'thumbs', out);
  const args = ['-y', '-loglevel', 'error'];
  if (kind === 'video') args.push('-ss', '1');
  args.push('-i', srcPath, '-frames:v', '1', '-vf', "scale='min(1200,iw)':-2", '-q:v', '4', outPath);
  return new Promise((resolve) => {
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 60000 }, (err) => {
      if (!err && fs.existsSync(outPath)) return resolve(out);
      if (kind === 'video') {
        // Very short clips: retry from the first frame.
        const retry = args.filter((a, i) => !(a === '-ss' || args[i - 1] === '-ss'));
        execFile(process.env.FFMPEG_PATH || 'ffmpeg', retry, { timeout: 60000 }, (e2) =>
          resolve(!e2 && fs.existsSync(outPath) ? out : null));
      } else resolve(null);
    });
  });
}

module.exports = { kindOf, makeThumb };
