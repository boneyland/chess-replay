// ---------- the dock ----------
// The dock: Import game, the Menu of starting points and tools (Explore, Play, More), Share and export, Settings and
// Full screen. On the wide layouts its buttons sit at the Transport bar's end with an error above them; on a phone they
// fold into a menu (the bar's Menu button), which also shows the page's status line. GameApp keeps the state (which
// menu or panel is open) and the refs it moves the focus and places Queen's panel by.
// a: the actions ({ importGame, newBoard, editPosition, explore960, playHuman, playSf, myGames, openKeys, askQueen,
// openShare })
function Dock({
  a,
  phone,
  short,
  shownErr,
  status,
  askable,
  queenOpen,
  setQueenOpen,
  newMenu,
  setNewMenu,
  menu,
  setMenu,
  panel,
  setPanel,
  refs,
  fullscreen,
  sound,
  setSound,
}) {
  const { importGame, newBoard, editPosition, explore960, playHuman, playSf, myGames, openKeys, askQueen, openShare } =
    a;
  const { newRef, newBtn, menuBtn, dockRef } = refs;
  const newGroups = [
    {
      label: 'Explore',
      items: [
        { label: 'Starting position', run: newBoard },
        { label: 'Edit position', run: editPosition },
        { label: 'Chess960 position', run: explore960 },
      ],
    },
    {
      label: 'Play',
      items: [
        { label: 'Play vs human', run: playHuman },
        { label: 'Play vs computer', run: playSf },
        { label: 'My games', run: myGames },
      ],
    },
    // Ask Queen sits here on the wide layouts; the folded menu keeps it in its last row. The folded menu's shortcuts item is hidden on a touch screen
    {
      label: 'More',
      items: [
        { label: 'Keyboard shortcuts', run: openKeys },
        ...(!phone && askable
          ? [
              {
                label: 'Ask Queen',
                cls: 'dock-queen',
                run: () => {
                  setNewMenu(false);
                  askQueen();
                },
              },
            ]
          : []),
      ],
    },
  ];
  const newItems = newGroups.map((g) => (
    <div key={g.label} className={`dock-group dock-group-${g.label.toLowerCase()}`}>
      <span className="dock-menu-label">{g.label}</span>
      {g.items.map((it) => (
        <button key={it.label} type="button" className={it.cls ? 'dock-btn ' + it.cls : 'dock-btn'} onClick={it.run}>
          {it.label}
        </button>
      ))}
    </div>
  ));
  const fsLabel = fullscreenLabel(fullscreen.on);
  const dockItems = (
    <div id="dock-items" className="dock-items part-dock">
      {phone && <span className="dock-menu-status">{shownErr || status}</span>}
      {/* Import game and Menu are icons on the bar, their names in the folded menu (the name stays in the button, hidden, for screen readers) */}
      <button type="button" className="dock-btn dock-primary dock-glyphed" title="Import game" onClick={importGame}>
        <svg className="dock-glyph" width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 10v3.5h11V10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="dock-label">Import game</span>
      </button>
      {/* a list of starting points and tools in groups, each under its heading; on the phone they sit in the folded menu */}
      {phone ? (
        newItems
      ) : (
        <div ref={newRef} className="dock-new">
          <button
            ref={newBtn}
            type="button"
            className="dock-btn dock-glyphed"
            title="Menu"
            aria-expanded={newMenu}
            aria-controls="dock-new-items"
            onClick={() => {
              setNewMenu((m) => !m);
              setPanel(false);
              setQueenOpen(false);
            }}
          >
            <svg className="dock-glyph" width="30" height="30" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="dock-label">Menu</span>
          </button>
          {newMenu && (
            <div id="dock-new-items" className="dock-pop part-play-explore-menu">
              {newItems}
            </div>
          )}
        </div>
      )}
      {/* Share and export, Settings and Full screen are icons in every layout; on the phone they share the menu's last row with Ask Queen */}
      <div className="dock-icons">
        {phone && askable && (
          <button
            type="button"
            className="dock-btn dock-queen"
            aria-expanded={queenOpen}
            onClick={() => {
              setMenu(false);
              askQueen();
            }}
          >
            Ask Queen
          </button>
        )}
        <button
          type="button"
          className="dock-btn dock-iconic"
          aria-label="Share and export"
          title="Share and export"
          aria-haspopup="dialog"
          onClick={openShare}
        >
          <svg className="dock-icon" width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d={SHARE} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="dock-btn dock-iconic"
          aria-label="Settings"
          title="Settings"
          aria-expanded={panel}
          onClick={() => {
            setMenu(false);
            setPanel((p) => !p);
            setQueenOpen(false);
          }}
        >
          <svg className="dock-icon" width="28" height="28" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d={GEAR} />
          </svg>
        </button>
        {phone && short && <SoundButton className="dock-btn dock-iconic" on={sound} onChange={setSound} />}
        {fullscreen.ok && (
          <button
            type="button"
            className="dock-btn dock-iconic"
            aria-label={fsLabel}
            title={fsLabel}
            onClick={() => {
              setMenu(false);
              fullscreen.toggle();
            }}
          >
            <FullscreenIcon on={fullscreen.on} />
          </button>
        )}
      </div>
    </div>
  );
  const menuEl = (
    <div ref={dockRef} className={'pmenu part-menu' + (shownErr ? ' pmenu-err' : '') + (menu ? ' pmenu-open' : '')}>
      <button
        ref={menuBtn}
        type="button"
        className="pbtn dock-menu"
        aria-label="Menu"
        aria-expanded={menu}
        aria-controls="dock-items"
        onClick={() => {
          setMenu((m) => !m);
          setPanel(false);
          setQueenOpen(false);
        }}
      >
        <svg width="30" height="30" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          {menu ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {dockItems}
    </div>
  );
  // landscape: the buttons sit at the end of the transport bar, with an error above them
  return phone ? (
    menuEl
  ) : (
    <div className="pdock">
      {shownErr && (
        <span className="dock-status" role="alert">
          {shownErr}
        </span>
      )}
      {dockItems}
    </div>
  );
}

// Full screen's name and icon, on the dock and (a phone held sideways with its bars showing) on the bar itself
const fullscreenLabel = (on) => (on ? 'Exit full screen' : 'Full screen');
function FullscreenIcon({ on }) {
  return (
    <svg className="dock-icon" width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={on ? 'M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4' : 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
