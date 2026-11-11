// Files downloaded only when the viewer asks, checked against pinned SHA-256s and kept in a cache of their own, which sw.js
// never clears on a deploy (Full Stockfish's engine, the board reader's model). make({ cache, base, files, host, what, onRemove }):
// files are { name, size, type, sha256 }, fetched from base + name; host and what ('full engine') word the messages;
// onRemove() runs before the cache is deleted (whatever holds the files lets them go). The files array is read at call
// time, not copied.
(function () {
  // the browser's room for the copy: the files, plus a margin for the cache's own records
  const ROOM_FACTOR = 1.1;
  const supported = () => typeof caches !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
  const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

  function make({ cache: CACHE, base, files, host, what, onRemove }) {
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
      const sum = await sha256(out);
      halt(signal); // Cancel during the check
      if (sum !== f.sha256) throw new Error(f.name + ' does not match its pinned checksum');
      return out;
    }

    // a Cancel the fetch can no longer see (during the check or the cache puts) stops the download there
    const halt = (signal) => { if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };

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
      halt(signal);
      const cache = await caches.open(CACHE);
      try {
        for (let i = 0; i < files.length; i++) {
          await cache.put(urlOf(files[i]), new Response(bodies[i], { headers: { 'content-type': files[i].type } }));
          halt(signal);
        }
      } catch (e) {
        await drop(cache);
        if (e && e.name === 'AbortError') throw e;
        throw new Error(/quota/i.test(e.name + e.message) ? 'Not enough storage space in this browser' : `The browser would not keep the ${what}`);
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }

    // The kept copy as Blob URLs, typed as files say (a module import or a Worker needs the type): { url(name), revoke() }.
    // It was checked when downloaded, so it is trusted now: only the sizes are compared, and the Blobs are passed on
    // without reading the files into the page. A file missing or of the wrong size (cut short, or from another version)
    // drops the whole copy and is refused, so the page offers the download again
    async function blobUrls() {
      const cache = await caches.open(CACHE), out = {};
      const revoke = () => { for (const u of Object.values(out)) URL.revokeObjectURL(u); };
      for (const f of files) {
        const r = await cache.match(urlOf(f)).catch(() => null);
        const blob = r && await r.blob();
        if (!blob || blob.size !== f.size) {
          revoke();
          await drop(cache);
          throw new Error(`The kept ${what} was missing or incomplete, so it was removed: download it again.`);
        }
        out[f.name] = URL.createObjectURL(blob.type === f.type ? blob : new Blob([blob], { type: f.type }));
      }
      return { url: (name) => out[name], revoke };
    }

    const remove = async () => { if (onRemove) onRemove(); return caches.delete(CACHE); };
    // Remove, for a Remove button: { kept, err }. A removal that fails says why (err), and kept is then whether the copy
    // is still there, so the page doesn't show it gone while it stays
    async function removeKept() {
      try { await remove(); return { kept: false, err: '' }; } catch (e) {
        return { kept: await present(), err: `The ${what} could not be removed: ` + ((e && e.message) || e) };
      }
    }

    return { files, cache: CACHE, urlOf, total, supported, present, download, blobUrls, remove, removeKept, drop, limits };
  }

  window.KeptFiles = { make };
})();
