// Settings panel + controls, adapted from Claude Design's tweaks-panel.jsx.
// Values persist per viewer in localStorage instead of being written back by the design host.

const TWEAK_STORE = 'chess-video.tweaks.v1';

function useTweaks(defaults) {
  const [values, setValues] = React.useState(() => {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(TWEAK_STORE) || 'null') || {}) }; } catch (e) { return defaults; }
  });
  const setTweak = React.useCallback((key, val) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem(TWEAK_STORE, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, []);
  return [values, setTweak];
}

// tabs: [{ id, label, body }], falsy ones left out; tab is the open one's id (the first tab when it isn't shown). Every
// layout gets the same panel: one column under a fixed grid of tabs, of one height whichever tab is open
function TweaksPanel({ open, onClose, title = 'Settings', tabs, tab, onTab }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const strip = React.useRef(null);
  if (!open) return null;
  const shown = tabs.filter(Boolean), cur = shown.find((x) => x.id === tab) || shown[0];
  // arrows, Home and End move between the tabs, as in a tab list
  const onKeyDown = (e) => {
    const i = shown.indexOf(cur), n = shown.length;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    onTab(shown[j % n].id);
    strip.current.children[j % n].focus();
  };
  return (
    <aside className="twk-panel twk-tabbed" aria-label={title}>
      <div className="twk-hd">
        <b>{title}</b>
        <button type="button" className="twk-x" aria-label="Close settings" onClick={onClose}>✕</button>
      </div>
      <div ref={strip} className="twk-tabs" role="tablist" aria-label={title} style={{ '--twk-tab-cols': shown.length <= 4 ? shown.length : Math.ceil(shown.length / 2) }} onKeyDown={onKeyDown}>
        {shown.map((x) => (
          <button key={x.id} id={'twk-tab-' + x.id} type="button" role="tab" aria-selected={x === cur} aria-controls="twk-tabpanel" tabIndex={x === cur ? 0 : -1} onClick={() => onTab(x.id)}>{x.label}</button>
        ))}
      </div>
      <div key={cur.id} className="twk-body" id="twk-tabpanel" role="tabpanel" aria-labelledby={'twk-tab-' + cur.id}><div className="twk-flow">{cur.body}</div></div>
    </aside>
  );
}

// a titled group of rows within a tab
function TweakSection({ label, children }) { return <section className="twk-group"><div className="twk-sect">{label}</div>{children}</section>; }

// info: the row's explanation, behind an ⓘ: a floating tip just above it on hover, focus or a tap, drawn into the page's
// body so no scrolling box clips it and no row grows
function InfoTip({ info, label }) {
  const btn = React.useRef(null), tip = React.useRef(null), id = React.useId();
  const [open, setOpen] = React.useState(false), [at, setAt] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    const r = btn.current.getBoundingClientRect(), w = tip.current.offsetWidth, h = tip.current.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    setAt({ left, top: r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6 });
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const away = (e) => { if (!btn.current.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    document.addEventListener('pointerdown', away); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="twk-info" aria-label={`About ${label}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
        onFocus={(e) => { if (e.target.matches(':focus-visible')) setOpen(true); }} onBlur={() => setOpen(false)}>i</button>
      {open && ReactDOM.createPortal(<div ref={tip} id={id} role="tooltip" className="twk-tip" style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}>{info}</div>, document.body)}
    </>
  );
}

function TweakRow({ label, value, info, children }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}{info && <InfoTip info={info} label={label} />}</span>{value != null && <span className="twk-val">{value}</span>}</div>
      {children}
    </div>
  );
}

// stops: the only values the slider takes, in order (uneven steps); it then moves through their indices
// format: a value's text, when it isn't just the value and its unit
function TweakSlider({ id, label, value, min = 0, max = 100, step = 1, stops, unit = '', format, info, onChange }) {
  const at = stops ? Math.max(0, stops.indexOf(value)) : value, text = format ? format(value) : `${value}${unit}`;
  return (
    <TweakRow label={label} value={text} info={info}>
      <input id={id} type="range" className="twk-slider" min={stops ? 0 : min} max={stops ? stops.length - 1 : max} step={stops ? 1 : step} value={at} aria-label={label} aria-valuetext={stops ? text : undefined} onChange={(e) => onChange(stops ? stops[Number(e.target.value)] : Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ id, label, value, info, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl" style={{ justifyContent: 'flex-start' }}><label htmlFor={id}>{label}</label>{info && <InfoTip info={info} label={label} />}</div>
      <button id={id} type="button" className="twk-toggle" data-on={value ? '1' : '0'} role="switch" aria-checked={!!value} onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakSelect({ id, label, aria, value, options, info, onChange, disabled }) {
  return (
    <TweakRow label={label} info={info}>
      <select id={id} className="twk-field" value={value} disabled={disabled} aria-label={aria || label} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </TweakRow>
  );
}

// Segmented control for 2–3 short options; longer labels fall back to a select
function TweakRadio({ id, label, value, options, onChange }) {
  const maxLen = options.reduce((m, o) => Math.max(m, String(o).length), 0);
  if (maxLen > ({ 2: 16, 3: 10 }[options.length] || 0)) return <TweakSelect id={id} label={label} value={value} options={options} onChange={onChange} />;
  return (
    <TweakRow label={label}>
      <div className="twk-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </TweakRow>
  );
}

// danger: a button that throws something away (after the viewer has been asked)
function TweakButton({ label, onClick, secondary = false, danger = false, disabled = false, info }) {
  const el = <button type="button" className={secondary ? 'twk-btn secondary' : danger ? 'twk-btn danger' : 'twk-btn'} disabled={disabled} onClick={onClick}>{label}</button>;
  return info ? <div className="twk-btn-row">{el}<InfoTip info={info} label={label} /></div> : el;
}

Object.assign(window, { useTweaks, TweaksPanel, TweakSection, InfoTip, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakButton });
