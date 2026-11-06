// ---------- kept-file downloads: the shared part of their UI ----------
// Full Stockfish (the Analysis panel's engine settings) and the board reader (Position from image) download files the
// viewer keeps (KeptFiles, app/kept-files.js). Both show the download the same way: a status line and a bar, a render
// per megabyte, Cancel, and a question before Remove.

const keptMB = (bytes) => Math.round(bytes / 1e6);

// A download's state for a panel or dialog: on (downloading), got (bytes so far) and err (why the last one failed, or
// what the caller set with setErr). start(run) runs run({ signal, onProgress }) (a KeptFiles download) and resolves
// true once it is kept, false if it failed or was cancelled (err says why, or nothing for a cancel), null if one was
// already running; cancel() stops it, as unmounting does
function useKeptDownload() {
  const [st, setSt] = React.useState({ on: false, got: 0, err: '' });
  const ctl = React.useRef(null), alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (ctl.current) ctl.current.abort(); };
  }, []);
  const set = (fn) => { if (alive.current) setSt(fn); };
  const start = async (run) => {
    if (ctl.current) return null;
    const c = ctl.current = new AbortController();
    set({ on: true, got: 0, err: '' });
    try {
      await run({ signal: c.signal, onProgress: (got) => set((s) => (keptMB(got) === keptMB(s.got) ? s : { ...s, got })) });
      set({ on: false, got: 0, err: '' });
      return true;
    } catch (e) {
      set({ on: false, got: 0, err: c.signal.aborted ? '' : 'Download failed: ' + ((e && e.message) || e) });
      return false;
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  };
  const cancel = () => { if (ctl.current) ctl.current.abort(); };
  const setErr = (err) => set((s) => ({ ...s, err }));
  return { ...st, start, cancel, setErr };
}

// The download under way: "Downloading <what> · 12 of 99 MB" and a bar
function KeptProgress({ what, got, total }) {
  return <>
    <div className="twk-note" role="status">Downloading {what} · {keptMB(got)} of {keptMB(total)} MB</div>
    <div className="twk-progress"><i style={{ width: `${(100 * got / total).toFixed(1)}%` }} /></div>
  </>;
}

// Remove's question, above its Remove and Keep buttons
const KeptRemoveAsk = ({ what, total }) => <div className="twk-note" role="alert">Remove the {what}? You’d need to download {keptMB(total)} MB again to use it.</div>;
