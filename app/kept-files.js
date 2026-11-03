// Files downloaded only when the viewer asks, checked against pinned SHA-256s and kept in a cache of their own, which sw.js
// never clears on a deploy (Full Stockfish's engine, the board reader's model). make({ cache, base, files, host, what }):
// files are { name, size, type, sha256 }, fetched from base + name; host and what ('engine') word the error messages.
// The files array is read at call time, not copied.
(function () {
  // the browser's room for the copy: the files, plus a margin for the cache's own records
  const ROOM_FACTOR = 1.1;
  const supported = () => typeof caches !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

  function make({ cache: CACHE, base, files, host, what }) {
    const urlOf = (f) => base + f.name;
    const total = () => files.reduce((s, f) => s + f.size, 0);

    // All files kept (checked when downloaded)
    async function present() {
      if (!supported()) return false;
      try {
        const cache = await caches.open(CACHE);
        for (const f of files) if (!(await cache.match(urlOf(f)))) return false;
        return true;
      } catch (e) { return false; }
    }

    // One file into memory as it arrives, no bigger than its pinned size; onBytes(n) for each chunk. A connection that
    // sends nothing for limits.stallMs (before the answer or between chunks) is given up, else the download waits forever
    const limits = { stallMs: 30000 };
    async function fetchFile(f, signal, onBytes) {
      const ctl = new AbortController(), stop = () => ctl.abort();
      let stalled = false, timer = null;
      const wait = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; stop(); }, limits.stallMs); };
      if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop); }
      const out = new Uint8Array(f.size);
      let at = 0;
      try {
        wait();
        const r = await fetch(urlOf(f), { mode: 'cors', cache: 'no-store', signal: ctl.signal });
        if (!r.ok) throw new Error(`${host} answered ${r.status} for ${f.name}`);
        const reader = r.body.getReader();
        for (;;) {
          wait();
          const { done, value } = await reader.read();
          if (done) break;
          if (at + value.length > f.size) { reader.cancel().catch(() => {}); throw new Error(f.name + ' is bigger than expected'); }
          out.set(value, at);
          at += value.length;
          onBytes(value.length);
        }
      } catch (e) {
        if (stalled) throw new Error(`${host} stopped sending ${f.name}`);
        throw e;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', stop);
      }
      if (at !== f.size) throw new Error(f.name + ' arrived incomplete');
      if ((await sha256(out)) !== f.sha256) throw new Error(f.name + ' does not match its pinned checksum');
      return out;
    }

    // these files out of the cache, other kept files left alone
    const drop = async (cache = null) => { cache = cache || await caches.open(CACHE); for (const f of files) await cache.delete(urlOf(f)).catch(() => {}); };

    // Downloads and keeps all files; nothing is kept unless all arrive whole and match. onProgress(bytes, total bytes).
    // Asks the browser to keep the copy when storage runs low (Chrome decides by itself, Firefox asks the viewer).
    async function download({ onProgress = () => {}, signal } = {}) {
      if (!supported()) throw new Error(`This browser can’t keep the ${what}`);
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const { quota, usage } = await navigator.storage.estimate();
          if (quota != null && quota - (usage || 0) < total() * ROOM_FACTOR) throw new Error('Not enough storage space in this browser');
        } catch (e) { if (/storage space/.test(e.message)) throw e; }
      }
      let got = 0;
      onProgress(0, total());
      const bodies = [];
      for (const f of files) bodies.push(await fetchFile(f, signal, (n) => { got += n; onProgress(got, total()); }));
      const cache = await caches.open(CACHE);
      try {
        for (let i = 0; i < files.length; i++) await cache.put(urlOf(files[i]), new Response(bodies[i], { headers: { 'content-type': files[i].type } }));
      } catch (e) {
        await drop(cache);
        throw new Error(/quota/i.test(e.name + e.message) ? 'Not enough storage space in this browser' : `The browser would not keep the ${what}`);
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }

    const remove = () => caches.delete(CACHE);

    return { files, cache: CACHE, urlOf, total, supported, present, download, remove, drop, limits };
  }

  window.KeptFiles = { make };
})();
