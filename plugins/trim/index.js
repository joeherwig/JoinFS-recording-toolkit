// Trim: non-destructive. The chosen range lives in `track.ext.trim = { startS, endS }` (source time of the
// recording); the timeline shades what will be cut, and the export transform removes it when saving. Editing runs
// in a non-modal dialog: the draft changes freely, Cancel throws it away, Apply is one undoable command.

const EPS = 1e-6;
const round1 = (x) => Math.round(x * 10) / 10;

function bounds(track) {
  const times = track.frames.times;
  let t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < times.length; i++) { if (times[i] < t0) t0 = times[i]; if (times[i] > t1) t1 = times[i]; }
  return { t0, t1 };
}

export function activate(ctx) {
  let session = null; // { trackId, t0, t1, draft: { startS, endS }, bar }

  // what the views show: the draft while editing, else the applied trim. Both show the track as it will be saved.
  const trimOf = (track) => (session && session.trackId === track.id ? session.draft : track.ext && track.ext.trim);

  ctx.tracks.registerRange((track) => trimOf(track) || null);

  function endSession() {
    if (!session) return;
    session.bar.close();
    session = null;
    ctx.ui.requestRedraw();
  }

  ctx.ui.registerTimelineLayer({
    draw(g, { track, top, height, width, toX }) {
      // the cut parts are not drawn at all; while editing, they are hinted in grey with the new borders marked
      if (!session || session.trackId !== track.id) return;
      const trim = session.draft;
      const x0 = toX(trim.startS), x1 = toX(trim.endS);
      g.fillStyle = 'rgba(127,127,127,.5)'; // neutral grey: readable on the light and the dark theme
      if (x0 > 0) g.fillRect(0, top, Math.min(x0, width), height);
      if (x1 < width) g.fillRect(Math.max(x1, 0), top, width - Math.max(x1, 0), height);
      g.strokeStyle = '#f59e0b';
      g.lineWidth = 2;
      for (const x of [x0, x1]) {
        if (x < 0 || x > width) continue;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + height); g.stroke();
      }
    },
  });

  ctx.io.registerExportTransform({
    id: 'apply',
    order: 50,
    apply: (tracks) => tracks
      .map((tr) => {
        const trim = tr.ext && tr.ext.trim;
        // the export copies already carry project time (offset applied); the trim is stored in source time
        return trim ? ctx.tracks.clip(tr, trim.startS + tr.timeOffsetS, trim.endS + tr.timeOffsetS) : tr;
      })
      .filter(Boolean),
  });

  ctx.ui.registerTrackAction({
    id: 'edit',
    label: 'action.edit',
    run({ trackId }) {
      const track = ctx.tracks.get(trackId);
      if (!track || !track.frames.times.length) return;
      endSession();
      const { t0, t1 } = bounds(track);
      const current = track.ext.trim || { startS: t0, endS: t1 };
      const dur = t1 - t0;
      const clamp = (rel) => Math.min(Math.max(rel, 0), dur);
      const toRel = (src) => round1(src - t0);

      const bar = ctx.ui.openDialog({
        title: ctx.i18n.t('bar.title', { name: track.callsign || track.id }),
        fields: [
          { id: 'start', label: ctx.i18n.t('field.start'), value: toRel(current.startS), step: 0.1, min: 0 },
          { id: 'end', label: ctx.i18n.t('field.end'), value: toRel(current.endS), step: 0.1, min: 0 },
        ],
        buttons: [
          { id: 'startHere', label: ctx.i18n.t('button.startHere') },
          { id: 'endHere', label: ctx.i18n.t('button.endHere') },
          { id: 'reset', label: ctx.i18n.t('button.reset') },
          { id: 'cancel', label: ctx.i18n.t('button.cancel') },
          { id: 'apply', label: ctx.i18n.t('button.apply'), primary: true },
        ],
        onChange(values) {
          if (!session) return;
          if (Number.isFinite(values.start)) session.draft.startS = t0 + clamp(values.start);
          if (Number.isFinite(values.end)) session.draft.endS = t0 + clamp(values.end);
          ctx.ui.requestRedraw();
        },
        onButton(id) {
          if (!session) return;
          const live = ctx.tracks.get(trackId);
          if (!live) return endSession();
          const draft = session.draft;
          // the playhead is project time; the track's own time is that minus its offset
          const here = clamp(ctx.time.get() - live.timeOffsetS - t0);
          if (id === 'startHere') { draft.startS = t0 + here; bar.setValues({ start: round1(here) }); }
          else if (id === 'endHere') { draft.endS = t0 + here; bar.setValues({ end: round1(here) }); }
          else if (id === 'reset') { draft.startS = t0; draft.endS = t1; bar.setValues({ start: 0, end: round1(dur) }); }
          else if (id === 'cancel') return endSession();
          else if (id === 'apply') return apply(live);
          ctx.ui.requestRedraw();
        },
      });
      session = { trackId, t0, t1, draft: { startS: current.startS, endS: current.endS }, bar };
      ctx.ui.requestRedraw();
    },
  });

  function apply(live) {
    const { t0, t1, draft } = session;
    if (!(draft.startS < draft.endS - EPS)) { ctx.ui.toast(ctx.i18n.t('toast.invalid')); return; }
    const full = draft.startS <= t0 + EPS && draft.endS >= t1 - EPS;
    const ext = live.ext; // live object shared with the frozen copy
    const before = ext.trim;
    const after = full ? undefined : { startS: draft.startS, endS: draft.endS };
    ctx.exec({
      label: 'Trim track',
      do: () => { if (after) ext.trim = after; else delete ext.trim; },
      undo: () => { if (before) ext.trim = before; else delete ext.trim; },
    });
    ctx.ui.toast(after
      ? ctx.i18n.t('toast.applied', { from: round1(after.startS - t0), to: round1(after.endS - t0) })
      : ctx.i18n.t('toast.cleared'));
    endSession();
  }
}

export function deactivate() { /* the host disposes the layer, transform and dialog */ }
