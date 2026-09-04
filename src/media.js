'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { LIMITS, formatBytes } = require('./utils');

/**
 * Offline media helpers for faceless pipelines (no browser).
 * `probe` reports what TikTok will think of a file; `fit` normalizes it
 * to vertical 1080x1920 H.264/AAC via ffmpeg when available.
 * All ffmpeg calls degrade gracefully when the binary is missing.
 */

function ffmpegAvailable() {
  try {
    const out = execFileSync('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return { ok: true, version: out.split('\n')[0].slice(0, 80) };
  } catch (_) {
    return { ok: false };
  }
}

function ffprobeStreams(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }
    ).toString();
    return JSON.parse(out);
  } catch (_) {
    return null;
  }
}

/**
 * Inspect a media file and judge TikTok-readiness.
 * Never throws for missing ffmpeg — duration/codec fields are null then.
 */
function probeFile(file) {
  if (!file) return { ok: false, error: 'missing file path' };
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return { ok: false, error: 'file not found: ' + file };
  const st = fs.statSync(resolved);
  if (!st.isFile()) return { ok: false, error: 'not a file: ' + file };
  if (st.size === 0) return { ok: false, error: 'empty file: ' + file };
  const ext = path.extname(resolved).toLowerCase();
  const kind = LIMITS.videoExts.includes(ext) ? 'video' : LIMITS.imageExts.includes(ext) ? 'image' : 'other';
  const issues = [];
  const warnings = [];
  if (kind === 'other') issues.push('unsupported extension "' + (ext || '(none)') + '" (expected ' + LIMITS.videoExts.join('/') + ')');
  if (st.size > LIMITS.maxVideoBytes) issues.push('file is ' + (st.size / 1024 / 1024 / 1024).toFixed(1) + ' GB (TikTok web limit ~10 GB)');
  else if (st.size > LIMITS.warnVideoBytes) warnings.push('large file (' + formatBytes(st.size) + '); upload may take a while');

  let durationSec = null;
  let width = null;
  let height = null;
  let vcodec = null;
  let acodec = null;
  if (kind === 'video') {
    const data = ffprobeStreams(resolved);
    if (data) {
      const vstream = (data.streams || []).find((s) => s.codec_type === 'video');
      const astream = (data.streams || []).find((s) => s.codec_type === 'audio');
      if (vstream) {
        vcodec = vstream.codec_name || null;
        width = Number(vstream.width) || null;
        height = Number(vstream.height) || null;
        const d = Number(vstream.duration || (data.format && data.format.duration));
        if (Number.isFinite(d)) durationSec = Math.round(d * 10) / 10;
      } else if (data.format && data.format.duration != null) {
        const d = Number(data.format.duration);
        if (Number.isFinite(d)) durationSec = Math.round(d * 10) / 10;
      }
      if (astream) acodec = astream.codec_name || null;
      if (vcodec && !/^(h264|hevc|h265|vp9|av1)$/i.test(vcodec)) warnings.push('video codec ' + vcodec + ' may transcode slowly — consider `captron fit` (H.264)');
      if (durationSec != null) {
        if (durationSec < 3) warnings.push('very short (' + durationSec + 's); TikTok minimum is ~3s');
        if (durationSec > 600) warnings.push('very long (' + durationSec + 's); TikTok web prefers ≤10 min');
      }
      if (width && height && height > 0 && width / height > 1.2) warnings.push('landscape ' + width + 'x' + height + ' — vertical 1080x1920 performs better (`captron fit`)');
    } else {
      warnings.push('ffprobe unavailable — install ffmpeg for duration/codec checks');
    }
  }
  return {
    ok: issues.length === 0,
    file: resolved,
    size: st.size,
    sizeHuman: formatBytes(st.size),
    ext,
    kind,
    durationSec,
    width,
    height,
    vcodec,
    acodec,
    issues,
    warnings,
    fitsTikTok: issues.length === 0,
  };
}

/** Pure ffmpeg argv builder for `fit` (unit-tested, no execution). */
function buildFitArgs({ input, output, width = 1080, height = 1920, fps = 30, crf = 20 } = {}) {
  const w = Math.max(16, Number(width) || 1080);
  const h = Math.max(16, Number(height) || 1920);
  return [
    '-y',
    '-i', input,
    '-vf', 'scale=' + w + ':' + h + ':force_original_aspect_ratio=increase,crop=' + w + ':' + h + ',setsar=1',
    '-r', String(Math.max(1, Number(fps) || 30)),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ];
}

/**
 * Normalize a video to vertical TikTok-ready MP4 via ffmpeg.
 * Returns { ok, output, bytes } or { ok:false, error }.
 */
function fitFile({ input, output, width, height, fps, crf } = {}) {
  if (!input) return { ok: false, error: 'missing input file' };
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) return { ok: false, error: 'file not found: ' + input };
  const ff = ffmpegAvailable();
  if (!ff.ok) return { ok: false, error: 'ffmpeg not found (install it: https://ffmpeg.org/download.html)' };
  const out = output ? path.resolve(output) : resolved.replace(/(\.[a-z0-9]+)?$/i, '.tiktok.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = buildFitArgs({ input: resolved, output: out, width, height, fps, crf });
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 });
  if (r.error) return { ok: false, error: 'ffmpeg failed: ' + r.error.message };
  if (r.status !== 0) return { ok: false, error: 'ffmpeg exited ' + r.status + ': ' + String(r.stderr).slice(-300) };
  try {
    const bytes = fs.statSync(out).size;
    return { ok: true, output: out, bytes };
  } catch (err) {
    return { ok: false, error: 'ffmpeg produced no output: ' + err.message };
  }
}

/** Remove stale Chromium Singleton lock files from all profiles. Returns { removed, profiles }. */
function fixStaleLocks() {
  const { profilesDir } = require('./utils');
  const removed = [];
  let profiles = [];
  try {
    profiles = fs.readdirSync(profilesDir());
  } catch (_) {
    return { ok: true, removed, profiles: 0 };
  }
  for (const p of profiles) {
    const dir = path.join(profilesDir(), p);
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const f = path.join(dir, name);
      try {
        if (fs.existsSync(f)) {
          fs.rmSync(f, { force: true });
          removed.push(p + '/' + name);
        }
      } catch (_) {}
    }
  }
  return { ok: true, removed, profiles: profiles.length };
}

module.exports = { ffmpegAvailable, ffprobeStreams, probeFile, buildFitArgs, fitFile, fixStaleLocks };
