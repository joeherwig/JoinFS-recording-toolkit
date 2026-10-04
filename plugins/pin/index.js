// Pin: locks a track in time. A pinned track cannot be dragged on the timeline (and its offset cannot change),
// which protects a reference track while the others are lined up against it. State lives in `track.ext.pin`
// (not saved into the recording); toggling goes through ctx.exec, so it is undoable.

const PIN_GLYPH = '\u{1F4CC}';

export function activate(ctx) {
  ctx.tracks.registerDragGuard((track) => !(track.ext && track.ext.pin));

  ctx.ui.registerTimelineLayer({
    draw(g, { track, top, height }) {
      if (!(track.ext && track.ext.pin)) return;
      g.font = '12px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(PIN_GLYPH, 4, top + height / 2);
    },
  });

  ctx.ui.registerTrackAction({
    id: 'toggle',
    label: 'action.toggle',
    run({ trackId }) {
      const track = ctx.tracks.get(trackId);
      if (!track) return;
      const ext = track.ext; // the live object: the frozen copy shares it
      const before = !!ext.pin;
      ctx.exec({
        label: before ? 'Unpin track' : 'Pin track',
        do: () => { ext.pin = !before; },
        undo: () => { ext.pin = before; },
      });
      ctx.ui.toast(ctx.i18n.t(before ? 'toast.unpinned' : 'toast.pinned', { name: track.callsign || track.id }));
    },
  });
}
