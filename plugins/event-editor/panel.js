// The event editor's dock panel and its help dialog. The panel floats over the map (above the timeline, which stays
// usable): full width on a phone, a 380 px card on larger screens. It only talks to the session (editor.js) and renders
// again on every change. All sizes of controls are at least 44 px for touch.
import { LANES, COLORS, SHORTCUTS } from './editor.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 75.4 -> "1:15.4", 3725.4 -> "1:02:05.4" */
export function formatTime(sec) {
  const tenths = Math.round(Math.max(0, sec) * 10), whole = Math.floor(tenths / 10), frac = tenths % 10;
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${h ? h + ':' + p(m) : m}:${p(s)}.${frac}`;
}
/** Inverse of formatTime, forgiving: "1:15.4", "75.4", "75,4", "1:02:05"; NaN when not a time. */
export function parseTime(text) {
  const parts = String(text).trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d+(\.\d*)?$/.test(x))) return NaN;
  return parts.reduce((acc, x) => acc * 60 + Number(x), 0);
}

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel {
    position: fixed; z-index: 1000; top: 56px; right: 8px; width: min(380px, calc(100vw - 16px));
    max-height: calc(100dvh - max(220px, 32vh) - 64px); display: flex; flex-direction: column;
    background: var(--panel-bg, #12141a); color: var(--fg, #e2e8f0); border: 1px solid var(--border, #262b36);
    border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.45); font: 14px system-ui, sans-serif;
  }
  @media (max-width: 600px) { .panel { left: 8px; right: 8px; width: auto; top: 48px; } }
  header { display: flex; align-items: center; gap: 4px; padding: 2px 4px 2px 14px; border-bottom: 1px solid var(--border, #262b36); }
  header h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 12px; }
  .panel.collapsed .body { display: none; }
  h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
  button, input[type=text] { font: inherit; color: inherit; }
  button {
    min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border, #262b36);
    background: var(--btn-bg, #1c212b); cursor: pointer; touch-action: manipulation;
  }
  button:hover:not(:disabled), button:focus-visible { background: var(--btn-bg-hover, #2d3748); outline: none; }
  button:focus-visible { box-shadow: 0 0 0 2px #f59e0b; }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.primary:hover:not(:disabled) { background: #1d4ed8; }
  button.quiet { background: transparent; border-color: transparent; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 99px; font-size: 12px; background: var(--btn-bg, #1c212b); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .adds { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .adds button { display: flex; align-items: center; gap: 6px; text-align: left; }
  .flaps-add { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
  .flaps-add input[type=range], .sel input[type=range] { flex: 1; min-height: 44px; }
  .sel { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .row .grow { flex: 1; }
  input[type=text] { min-height: 44px; width: 7.5em; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border, #262b36); background: var(--input-bg, #0e1116); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  ul button { width: 100%; display: flex; align-items: center; gap: 8px; justify-content: flex-start; text-align: left; border-color: transparent; background: transparent; }
  ul button .t { margin-left: auto; opacity: .7; font-variant-numeric: tabular-nums; }
  ul button[aria-current=true] { background: var(--btn-bg-hover, #2d3748); border-color: #f59e0b; }
  .muted { opacity: .65; font-size: 13px; margin: 0; }
  .ground { display: flex; gap: 10px; align-items: flex-start; min-height: 44px; }
  .ground input { width: 24px; height: 24px; margin-top: 10px; flex: none; }
  .ground span { padding-top: 10px; }
  footer { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border, #262b36); }
  footer .grow { flex: 1; }
`;

/** Builds the panel, shows it, and removes it again when the session ends. */
export function mountPanel(ctx, ed) {
  const t = (k, p) => ctx.i18n.t(k, p);
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  const root = host.shadowRoot;
  let collapsed = false;
  let flapsPct = 50;
  let help = null;
  const track0 = ctx.tracks.get(ed.trackId);
  const name = track0.callsign || track0.model || track0.id;

  const changeLabel = (channel, value) => {
    if (channel === 'gear') return t(value ? 'change.gear.1' : 'change.gear.0');
    if (channel === 'flaps') return t('change.flaps', { pct: Math.round(value * 100) });
    return t(value ? 'change.light.1' : 'change.light.0', { name: t(`lane.${channel}`) });
  };
  const dot = (ch) => `<span class="dot" style="background:${COLORS[ch]}"></span>`;
  const rel = (timeS) => formatTime(timeS - ed.t0);

  function render() {
    const play = ed.playheadS();
    const state = ed.stateAt(play);
    const sel = ed.selectedEvent();
    const chips = LANES.filter((c) => state[c] !== undefined).map((c) => `<span class="chip">${dot(c)}${esc(changeLabel(c, state[c]))}</span>`).join('');

    const adds = LANES.map((c) => {
      if (c === 'flaps') {
        const cur = state.flaps;
        const same = cur !== undefined && ctx.variables.rules.valuesEqual('flaps', cur, flapsPct / 100);
        return `<div class="flaps-add">${dot(c)}<input type="range" min="0" max="100" step="5" value="${flapsPct}" data-act="flaps-range" aria-label="${esc(t('add.flapsRange'))}">
          <button data-act="add-flaps" ${same ? 'disabled' : ''}>${esc(t('add.flapsButton', { pct: flapsPct }))}</button></div>`;
      }
      const values = ed.offered(c) || [];
      return values.map((v) => `<button data-act="add" data-ch="${c}" data-v="${v}">${dot(c)}${esc(t('add.button', { change: changeLabel(c, v) }))}</button>`).join('');
    }).join('');

    let selHtml;
    if (!sel) selHtml = `<p class="muted">${esc(t('sel.none'))}</p>`;
    else {
      selHtml = `<div class="row">${dot(sel.channel)}<strong class="grow">${esc(changeLabel(sel.channel, sel.value))}</strong>
          <button data-act="delete" aria-label="${esc(t('sel.delete'))}" title="${esc(t('sel.delete'))} (Del)">${esc(t('sel.delete'))}</button></div>
        <div class="row">
          <label for="time">${esc(t('sel.time'))}</label>
          <input id="time" type="text" inputmode="decimal" autocomplete="off" value="${esc(rel(sel.timeS))}" data-act="time">
          ${[[-1, '−1 s', 'nudge.earlier'], [-0.1, '−0.1 s', 'nudge.earlier'], [0.1, '+0.1 s', 'nudge.later'], [1, '+1 s', 'nudge.later']]
            .map(([dt, label, key]) => `<button data-act="nudge" data-dt="${dt}" aria-label="${esc(t(key, { s: Math.abs(dt) }))}" title="${esc(t(key, { s: Math.abs(dt) }))}">${label}</button>`).join('')}
        </div>`;
      if (sel.channel === 'flaps') {
        selHtml += `<div class="row"><span>${esc(t('sel.flaps', { pct: Math.round(sel.value * 100) }))}</span>
          <input type="range" min="0" max="100" step="5" value="${Math.round(sel.value * 100)}" data-act="flaps-value" aria-label="${esc(t('sel.flapsRange'))}"></div>`;
      }
    }

    const events = ed.events();
    const list = events.length
      ? `<ul>${events.map((e) => {
        const cur = sel && sel.channel === e.channel && sel.index === e.index;
        return `<li><button data-act="pick" data-ch="${e.channel}" data-i="${e.index}" aria-current="${cur}">${dot(e.channel)}<span>${esc(changeLabel(e.channel, e.value))}</span><span class="t">${esc(rel(e.timeS))}</span></button></li>`;
      }).join('')}</ul>`
      : `<p class="muted">${esc(t('list.empty'))}</p>`;

    root.innerHTML = `<style>${STYLE}</style>
      <section class="panel ${collapsed ? 'collapsed' : ''}" role="region" aria-label="${esc(t('title', { name }))}">
        <header>
          <h2>${esc(t('title', { name }))}</h2>
          <button class="quiet" data-act="collapse" aria-expanded="${!collapsed}" aria-label="${esc(t(collapsed ? 'btn.expand' : 'btn.collapse'))}" title="${esc(t(collapsed ? 'btn.expand' : 'btn.collapse'))}">${collapsed ? '▾' : '▴'}</button>
          <button class="quiet" data-act="help" aria-label="${esc(t('btn.help'))}" title="${esc(t('btn.help'))}">?</button>
        </header>
        <div class="body">
          <div><h3>${esc(t('state.title', { time: rel(play) }))}</h3><div class="chips">${chips || `<span class="muted">${esc(t('state.none'))}</span>`}</div></div>
          <div><h3>${esc(t('add.title', { time: rel(play) }))}</h3><div class="adds">${adds}</div></div>
          <div><h3>${esc(t('sel.title'))}</h3><div class="sel">${selHtml}</div></div>
          <div><h3>${esc(t('list.title'))}</h3>${list}</div>
          <label class="ground"><input type="checkbox" data-act="ground" ${ed.forceGround ? 'checked' : ''}><span>${esc(t('ground.label'))}<br><small class="muted">${esc(t('ground.hint'))}</small></span></label>
        </div>
        <footer>
          <button data-act="undo" ${ed.canUndo ? '' : 'disabled'}>${esc(t('btn.undo'))}</button>
          <button data-act="redo" ${ed.canRedo ? '' : 'disabled'}>${esc(t('btn.redo'))}</button>
          <span class="grow"></span>
          <button data-act="cancel">${esc(t('btn.cancel'))}</button>
          <button data-act="done" class="primary">${esc(t('btn.done'))}</button>
        </footer>
      </section>`;
    const current = root.querySelector('ul [aria-current="true"]');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') ed.add(b.dataset.ch, Number(b.dataset.v));
    else if (act === 'add-flaps') ed.add('flaps', flapsPct / 100);
    else if (act === 'delete') ed.remove();
    else if (act === 'nudge') ed.nudge(Number(b.dataset.dt));
    else if (act === 'pick') {
      ed.select(b.dataset.ch, Number(b.dataset.i));
      const ev = ed.selectedEvent();
      if (ev) ctx.time.set(ev.timeS + ctx.tracks.get(ed.trackId).timeOffsetS);
    } else if (act === 'collapse') { collapsed = !collapsed; render(); }
    else if (act === 'help') toggleHelp();
    else if (act === 'undo') ed.undo();
    else if (act === 'redo') ed.redo();
    else if (act === 'cancel') ed.cancel();
    else if (act === 'done') ed.done();
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.act === 'flaps-range') {            // only the label follows while dragging; the add is a click
      flapsPct = Number(e.target.value);
      const btn = root.querySelector('[data-act="add-flaps"]');
      if (btn) btn.textContent = t('add.flapsButton', { pct: flapsPct });
    }
  });
  root.addEventListener('change', (e) => {
    const act = e.target.dataset.act;
    if (act === 'ground') ed.setForceGround(e.target.checked);
    else if (act === 'flaps-value') ed.setValue(Number(e.target.value) / 100);
    else if (act === 'flaps-range') render();
    else if (act === 'time') {
      const v = parseTime(e.target.value);
      if (Number.isFinite(v)) ed.moveTo(ed.t0 + v); else render();
      render();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.act === 'time') e.target.blur();
  });

  function toggleHelp() {
    if (help) { help.close(); return; }
    const body = document.createElement('div');
    body.tabIndex = -1;
    const groups = new Map();
    for (const s of SHORTCUTS) groups.set(s.help, [...(groups.get(s.help) || []), s.label]);
    body.innerHTML = `<p>${esc(t('help.intro'))}</p><p>${esc(t('help.touch'))}</p>
      <table style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:left;padding:4px 8px">${esc(t('help.col.key'))}</th><th style="text-align:left;padding:4px 8px">${esc(t('help.col.action'))}</th></tr></thead><tbody>
      ${[...groups].map(([key, labels]) => `<tr><td style="padding:4px 8px;white-space:nowrap"><kbd>${labels.map(esc).join('</kbd> / <kbd>')}</kbd></td><td style="padding:4px 8px">${esc(t(key))}</td></tr>`).join('')}
      </tbody></table>`;
    body.addEventListener('keydown', (e) => { if (e.key === '?') { e.preventDefault(); help && help.close(); } });
    help = ctx.ui.openModal({ title: t('help.title'), compact: true, onClose: () => { help = null; } });
    help.body.appendChild(body);
  }

  const offs = [ed.on('change', render), ed.on('help-request', toggleHelp),
    ed.on('add-request', () => { const b = root.querySelector('[data-act="add"], [data-act="add-flaps"]'); if (b) b.focus(); }),
    ed.on('end', () => { if (help) help.close(); host.remove(); })];
  // the playhead moves while the panel is open: the "at playhead" state follows it
  const timer = setInterval(() => { if (!ed.ended && document.activeElement !== host) { const p = ed.playheadS(); if (p !== lastPlay) { lastPlay = p; render(); } } }, 250);
  let lastPlay = ed.playheadS();
  offs.push(() => clearInterval(timer));
  ed.on('end', () => offs.forEach((off) => off()));
  render();
}
