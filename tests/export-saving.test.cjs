// The export's sound encoding and the page's file saving, run from their source in export.jsx and game-app.jsx (joined
// JSX files, so not units loadUnit can load): each function is taken out by name and run against fakes of the browser
// APIs it calls.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app');
// the source of a declaration starting at `start` (a line's text from its indent), to the line closing it at that indent
function source(file, start) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8'),
    at = src.indexOf(start);
  assert.ok(at >= 0, `${start} in ${file}`);
  const indent = src.slice(src.lastIndexOf('\n', at) + 1, at),
    end = src.indexOf('\n' + indent + '}', at);
  return src.slice(at, src.indexOf('\n', end + 1));
}

// ---- encodeSound: the soundtrack through WebCodecs' AudioEncoder ----
// A fake AudioEncoder that fails as WebCodecs does: once failed (failAt: the encode() count after which it fails, in a
// timer as the browser's task would), its state is 'closed' and the error callback has run; encode(), flush() and
// close() on a closed codec throw an InvalidStateError
// fullAfter: the encode() count from which its queue stays full (4 slices waiting)
function fakeEncoder({ failAt = Infinity, fullAfter = Infinity, failMs = 5 } = {}) {
  const made = [];
  class AudioEncoder {
    constructor({ output, error }) {
      this.output = output;
      this.error = error;
      this.state = 'unconfigured';
      this.encoded = 0;
      made.push(this);
    }
    get encodeQueueSize() {
      return this.encoded >= fullAfter ? 4 : 0;
    }
    shut() {
      if (this.state === 'closed') {
        const e = new Error('Cannot call on a closed codec');
        e.name = 'InvalidStateError';
        throw e;
      }
    }
    configure() {
      this.shut();
      this.state = 'configured';
    }
    encode() {
      this.shut();
      this.encoded++;
      this.output({ data: new Uint8Array([0]), type: 'key' }, { decoderConfig: { codec: 'mp4a.40.2' } });
      if (this.encoded === failAt)
        setTimeout(() => {
          this.state = 'closed';
          const e = new Error('Encoding error');
          e.name = 'EncodingError';
          this.error(e);
        }, failMs);
    }
    async flush() {
      this.shut();
    }
    close() {
      this.shut();
      this.state = 'closed';
    }
  }
  return { AudioEncoder, made };
}
class AudioData {
  constructor(o) {
    Object.assign(this, o);
  }
  close() {}
}
const MB = {
  EncodedPacket: class {
    constructor(data, type, t, dur) {
      Object.assign(this, { data, type, t, dur });
    }
    static fromEncodedChunk(c) {
      return { data: c.data, type: c.type };
    }
  },
};
// a sound of `windows` windows, each a second of stereo at 8 kHz, with a pause between windows (rendering one)
const fakeSound = (windows = 2, gapMs = 20) => ({
  sampleRate: 8000,
  numberOfChannels: 2,
  async *chunks() {
    for (let w = 0; w < windows; w++) {
      if (w) await new Promise((ok) => setTimeout(ok, gapMs));
      const ch = new Float32Array(8000);
      yield { at: w * 8000, buffer: { length: 8000, getChannelData: () => ch } };
    }
  },
});
function encodeSoundWith(fake) {
  const ctx = vm.createContext({ AudioEncoder: fake.AudioEncoder, AudioData, setTimeout, clearTimeout, Promise });
  vm.runInContext(
    source('export.jsx', 'const opusPacketSeconds') + '\n' + source('export.jsx', 'async function encodeSound'),
    ctx,
  );
  return ctx.encodeSound;
}

test('encodeSound: the soundtrack comes out as packets, one per slice, timed by AAC frames', async () => {
  const fake = fakeEncoder();
  const out = await encodeSoundWith(fake)(MB, fakeSound(2), 'aac');
  assert.equal(out.length, 4); // half-second slices of two one-second windows
  assert.deepEqual(out[0][1], { decoderConfig: { codec: 'mp4a.40.2' } });
  assert.equal(out[1][0].t, 1024 / 8000);
  assert.equal(fake.made[0].state, 'closed');
});

test('encodeSound: an encoder that fails between windows rejects with its own error, not a closed codec’s', async () => {
  const fake = fakeEncoder({ failAt: 1 });
  await assert.rejects(encodeSoundWith(fake)(MB, fakeSound(2), 'aac'), { name: 'EncodingError' });
});

test('encodeSound: an encoder that fails while the slices wait for room isn’t given another slice', async () => {
  // the queue full after the first slice: the second waits for room (a 20 ms poll), and the encoder fails meanwhile
  const fake = fakeEncoder({ failAt: 1, fullAfter: 1 });
  await assert.rejects(encodeSoundWith(fake)(MB, fakeSound(1), 'aac'), { name: 'EncodingError' });
  assert.equal(fake.made[0].encoded, 1);
});

// ---- saveFile: a download through a Blob URL ----
function saveFileWith() {
  const made = [],
    revoked = [],
    timers = [];
  const ctx = vm.createContext({
    Blob: class {
      constructor(parts, o) {
        this.parts = parts;
        this.type = o.type;
      }
    },
    URL: {
      createObjectURL: (b) => (made.push(b), 'blob:' + made.length),
      revokeObjectURL: (u) => revoked.push(u),
    },
    document: {
      createElement: () => ({ click() {}, remove() {} }),
      body: { appendChild() {} },
    },
    setTimeout: (f, ms) => timers.push({ f, ms }),
  });
  vm.runInContext(source('game-app.jsx', 'const saveFile'), ctx);
  return { saveFile: vm.runInContext('saveFile', ctx), made, revoked, timers };
}

test('saveFile keeps the Blob URL for a minute, as iOS Safari asks before it fetches the file', () => {
  const s = saveFileWith();
  s.saveFile('a.pgn', '1. e4', 'application/x-chess-pgn');
  assert.equal(s.made.length, 1);
  assert.deepEqual(s.revoked, []);
  assert.equal(s.timers.length, 1);
  assert.ok(s.timers[0].ms >= 60000, `revoked after ${s.timers[0].ms} ms`);
  s.timers[0].f();
  assert.deepEqual(s.revoked, ['blob:1']);
});
