// Event editor: move, add and delete the gear, flaps and light events of a track, and force its "on ground" flag.
// The session (editor.js) works on a draft; Done applies it as one undoable command. See README.md.
import { createEditor } from './editor.js';

let current = null; // the running session, so that disabling the plugin ends it

export function activate(ctx) {
  let editor = null;

  ctx.ui.registerTrackAction({
    id: 'edit',
    label: 'action.edit',
    async run({ trackId }) {
      const track = ctx.tracks.get(trackId);
      if (!track || !track.frames.times.length) return;
      if (editor) editor.cancel();                       // one session at a time
      const { mountPanel } = await import('./panel.js');
      const session = createEditor(ctx, trackId, { onEnd: () => { if (editor === session) editor = null; } });
      editor = session;
      current = session;
      mountPanel(ctx, session);
    },
  });

}

export function deactivate() { if (current) current.cancel(); current = null; }
