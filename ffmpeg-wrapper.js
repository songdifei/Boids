// ESM wrapper for ffmpeg.wasm with a simple global converter.
// Exposes: window.convertWebMToMP4(webmBlob) -> Promise<Blob(mp4)>

import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

let _ffmpeg;
let _loading;

async function getFFmpeg() {
  if (_ffmpeg && _ffmpeg.loaded) return _ffmpeg;
  if (_loading) return _loading;
  _ffmpeg = new FFmpeg();
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  _loading = _ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  }).then(() => _ffmpeg);
  return _loading;
}

async function convertWebMToMP4(webmBlob, onProgress) {
  const ffmpeg = await getFFmpeg();

  if (typeof onProgress === 'function') {
    try {
      ffmpeg.on('progress', ({ progress }) => {
        // progress ~ 0..1
        onProgress(Math.max(0, Math.min(1, progress || 0)));
      });
    } catch (_) {
      // ignore progress hookup errors
    }
  }

  // Unique filenames per run to avoid cache overlap
  const inName = `input_${Date.now()}.webm`;
  const outName = `output_${Date.now()}.mp4`;

  await ffmpeg.writeFile(inName, await fetchFile(webmBlob));

  // Try libx264 first; if unavailable, fallback to mpeg4
  const tries = [
    ['-i', inName, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-movflags', 'faststart', outName],
    ['-i', inName, '-pix_fmt', 'yuv420p', '-vcodec', 'mpeg4', '-b:v', '2000k', outName],
    ['-i', inName, outName],
  ];

  let ok = false;
  for (const args of tries) {
    try {
      await ffmpeg.exec(args);
      ok = true;
      break;
    } catch (e) {
      // try next
    }
  }
  if (!ok) throw new Error('FFmpeg failed to convert WebM to MP4');

  const data = await ffmpeg.readFile(outName);
  // Cleanup (best-effort)
  try { await ffmpeg.deleteFile(inName); } catch {}
  try { await ffmpeg.deleteFile(outName); } catch {}

  return new Blob([data.buffer], { type: 'video/mp4' });
}

window.convertWebMToMP4 = convertWebMToMP4;
