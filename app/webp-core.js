// Animated WebP for the export: libwebp encodes each frame as a still WebP (export.jsx), and this wraps
// those stills' image chunks in one animated file (RIFF: VP8X, ANIM, then an ANMF chunk per frame). Like libwebp's
// own animation encoder, a frame holds only the rectangle that changed since the last one (changedBox), drawn over
// the frame before: a moving piece is a small patch rather than the whole picture again.
// Frames stay Blobs throughout, so a long export never needs the whole file in one buffer.
(function () {
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  const le32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

  // Where a still WebP's image data starts, from its first bytes: past the RIFF header and any VP8X, ICCP (Chromium
  // adds a colour profile), EXIF or XMP chunk. What follows is ALPH + VP8, VP8 or VP8L, which is exactly what an ANMF
  // chunk holds. alpha: whether the frame has transparency.
  function stillImage(head) {
    if (head.length < 20 || fourcc(head, 0) !== 'RIFF' || fourcc(head, 8) !== 'WEBP')
      throw new Error('not a WebP image');
    let alpha = false;
    for (let at = 12; at + 8 <= head.length; ) {
      const id = fourcc(head, at),
        len = le32(head, at + 4);
      if (id === 'ALPH' || id === 'VP8 ') return { offset: at, alpha: alpha || id === 'ALPH' };
      // VP8L: signature byte, then 14 + 14 bits of width and height, then the alpha bit
      if (id === 'VP8L') return { offset: at, alpha: alpha || !!(head[at + 12] & 0x10) };
      if (id === 'VP8X') alpha = !!(head[at + 8] & 0x10);
      at += 8 + len + (len & 1);
    }
    throw new Error('no image data in the first ' + head.length + ' bytes');
  }

  // Each frame's duration in whole milliseconds (all WebP can hold), rounded so the frames add up to the right time:
  // at 12 fps that is 83, 84, 83, 83, 84, … rather than 83 throughout, which would drift 4 s behind per 10 minutes
  const durations = (n, fps) =>
    Array.from({ length: n }, (_, i) => Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps));

  // The smallest rectangle holding every pixel that differs between two RGBA pictures of width × height (ImageData
  // .data), or null when they are the same. x and y are even, as an ANMF chunk stores them halved.
  function changedBox(prev, cur, width, height) {
    const a = new Uint32Array(prev.buffer, prev.byteOffset, width * height),
      b = new Uint32Array(cur.buffer, cur.byteOffset, width * height);
    const rowDiffers = (y) => {
      for (let i = y * width, end = i + width; i < end; i++) if (a[i] !== b[i]) return true;
      return false;
    };
    let top = 0;
    while (top < height && !rowDiffers(top)) top++;
    if (top === height) return null;
    let bottom = height - 1;
    while (!rowDiffers(bottom)) bottom--;
    let left = width,
      right = -1;
    for (let y = top; y <= bottom; y++) {
      const row = y * width;
      for (let x = 0; x < left; x++)
        if (a[row + x] !== b[row + x]) {
          left = x;
          break;
        }
      for (let x = width - 1; x > right; x--)
        if (a[row + x] !== b[row + x]) {
          right = x;
          break;
        }
    }
    const x = left & ~1,
      y = top & ~1;
    return { x, y, w: right + 1 - x, h: bottom + 1 - y };
  }

  // frames: [{ data: Blob or Uint8Array holding a frame's image chunks, size: its length in bytes, duration: ms,
  // alpha, and x, y, w, h: where it goes on the canvas (default: all of it) }]. Returns the file's parts, for
  // new Blob(parts, { type: 'image/webp' }). loop: 0 plays forever.
  function mux(frames, { width, height, loop = 0 }) {
    if (!frames.length) throw new Error('no frames');
    const alpha = frames.some((f) => f.alpha);
    const vp8x = [
      ...ascii('VP8X'),
      ...u32(10),
      (alpha ? 0x10 : 0) | 0x02,
      0,
      0,
      0,
      ...u24(width - 1),
      ...u24(height - 1),
    ];
    const anim = [...ascii('ANIM'), ...u32(6), 0, 0, 0, 0, loop & 255, (loop >> 8) & 255];
    const parts = [],
      pad = new Uint8Array(1);
    let size = 4 + vp8x.length + anim.length;
    for (const f of frames) {
      if (f.duration < 1 || f.duration > 0xffffff) throw new Error('frame duration out of range: ' + f.duration);
      const { x = 0, y = 0, w = width, h = height } = f;
      if (x & 1 || y & 1 || x + w > width || y + h > height)
        throw new Error(`frame rectangle ${x},${y} ${w}×${h} doesn't fit`);
      // flags 0x02: the rectangle replaces what is under it (no blending), and stays for the next frame (not disposed)
      const body = [...u24(x / 2), ...u24(y / 2), ...u24(w - 1), ...u24(h - 1), ...u24(f.duration), 0x02];
      parts.push(new Uint8Array([...ascii('ANMF'), ...u32(body.length + f.size), ...body]), f.data);
      // RIFF chunks are padded to even length
      if (f.size & 1) parts.push(pad);
      size += 8 + body.length + f.size + (f.size & 1);
    }
    return [new Uint8Array([...ascii('RIFF'), ...u32(size), ...ascii('WEBP'), ...vp8x, ...anim])].concat(parts);
  }

  window.WebPAnim = { stillImage, durations, changedBox, mux };
})();
