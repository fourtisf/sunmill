'use client';

/**
 * The whole game is one canvas plus a DOM overlay, exactly as in the prototype.
 * React only owns the markup; everything after mount is the game modules.
 */
import { useEffect } from 'react';

export default function Game() {
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    // The game modules touch document/canvas, so they load client-side only.
    import('../game/boot').then((mod) => {
      if (cancelled) return;
      stop = mod.shutdown;
      void mod.boot();
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <>
      <canvas id="world" />
      <div id="ui">
        <div id="hud" />
        <div id="rail" />
        <div id="dock"><div className="dock-inner" id="dockInner" /></div>
        <div id="toasts" />
      </div>
      <div id="joystick" />
      <div id="scrim"><div className="modal panel" id="modal" /></div>
      <div id="lvlup"><div className="lu" id="luBody" /></div>
      <div id="intro">
        <div className="icard panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brandmark" src="/brand/sunmil-logo-stacked.svg" alt="SUNMIL" width={760} height={600} />
          <div className="tl" id="introTagline">Farm &amp; Craft Tycoon</div>
          <p id="introBlurb">A production-chain farm on Robinhood Chain. Grow crops, feed animals, run the machines, fill the truck.</p>
          <div className="hint">
            <span className="d" />
            <span id="introHint1"><b>Sweep to plant.</b> Pick a seed below, then drag across your fields in one motion.</span>
          </div>
          <div className="hint">
            <span className="d" />
            <span id="introHint2"><b>Tap anything ready.</b> Golden glow means harvest, collect, or claim.</span>
          </div>
          <div className="hint">
            <span className="d" />
            <span id="introScale"><b>Your farm keeps running</b> while you are away — the server holds the clock.</span>
          </div>
          <button className="btn gold go" id="introGo">Start farming</button>
        </div>
      </div>
    </>
  );
}
