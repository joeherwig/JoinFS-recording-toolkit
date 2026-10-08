// Edit aircraft: changes the aircraft type (ICAO), callsign / tail number and pilot nickname of a loaded track and shifts its
// altitude so that it starts at a given value. The form is the <jfs-edit-aircraft> element in a plugin modal. Applying is one
// undoable command (ctx.exec); the values are saved with the recording like any other track field.
import { fixIndices, firstFix, lookupElevation } from './logic.js';

/** Advanced / tests: `fetch` replaces the network call of the ground-altitude lookup. */
export const options = { fetch: undefined };

const LABEL_KEYS = ['field.icao', 'field.callsign', 'field.nickname', 'field.altitude', 'unit.label', 'unit.ft', 'unit.m', 'hint.icao',
  'hint.callsign', 'hint.nickname', 'hint.altitude', 'hint.noaltitude', 'err.icao', 'err.length', 'err.altitude', 'btn.apply', 'btn.cancel', 'btn.reset', 'btn.lookup', 'btn.lookup.title', 'status.checking', 'status.found', 'err.lookup'];

export function activate(ctx) {
  ctx.ui.registerTrackAction({
    id: 'edit',
    label: 'action.edit',
    async run({ trackId }) {
      const track = ctx.tracks.get(trackId);
      if (!track) return;
      await import('./edit-aircraft-form.js');                        // defines <jfs-edit-aircraft>
      const name = track.callsign || track.model || track.id;
      const modal = ctx.ui.openModal({ title: ctx.i18n.t('title', { name }), compact: true });
      const fix = firstFix(track);
      const form = document.createElement('jfs-edit-aircraft');
      form.labels = Object.fromEntries(LABEL_KEYS.map((k) => [k, ctx.i18n.t(k)]));
      form.values = { icaoType: track.icaoType || '', callsign: track.callsign || '', nickname: track.nickname || '', altitudeM: fix ? fix.alt : null };
      if (fix) form.lookup = () => lookupElevation(fix.lat, fix.lon, options.fetch ? { fetch: options.fetch } : {});
      form.addEventListener('cancel', () => modal.close());
      form.addEventListener('apply', (e) => {
        const changed = applyEdit(ctx, trackId, e.detail);
        ctx.ui.toast(ctx.i18n.t(changed ? 'toast.done' : 'toast.nochange', { name }));
        modal.close();
      });
      modal.body.appendChild(form);
    },
  });
}

/** Applies `{ icaoType?, callsign?, nickname?, altitudeDeltaM? }` as one undoable command (a shift also drops the track's cached ground-height profile, see `ground-height`); returns false if there was nothing to do. */
export function applyEdit(ctx, trackId, change) {
  const { altitudeDeltaM, ...text } = change || {};
  const track = ctx.tracks.get(trackId);
  const shift = Number.isFinite(altitudeDeltaM) && altitudeDeltaM !== 0;
  if (!track || (!Object.keys(text).length && !shift)) return false;
  const alt = track.frames.alt;                                        // the live array: the frozen copy shares it
  const savedAlt = shift ? Float64Array.from(alt) : null;
  const idx = shift ? fixIndices(track) : [];
  const ext = track.ext;                                               // the live plugin-data object
  const groundBefore = shift ? ext.groundHeight : undefined;           // a looked-up ground profile belongs to the old altitudes
  let before = {};
  ctx.exec({
    label: 'Edit aircraft',
    do: () => {
      before = ctx.tracks.patch(trackId, text);
      for (const i of idx) alt[i] = savedAlt[i] + altitudeDeltaM;
      if (shift) delete ext.groundHeight;                              // dropped: the terrain curve is looked up again on demand
    },
    undo: () => {
      ctx.tracks.patch(trackId, before);
      if (savedAlt) alt.set(savedAlt);
      if (groundBefore) ext.groundHeight = groundBefore;
    },
  });
  return true;
}
