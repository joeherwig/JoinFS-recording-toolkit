# Writing a Plugin

This page describes **Host API v1** as it is implemented. Read [Plugin Concept](Plugin-Concept) first. The two
plugins in `plugins/pin` and `plugins/trim` are working examples.

## 1. Create the folder

```
plugins/hello/
  manifest.json
  index.js
  locales/en.json
  locales/de.json
```

Then add `'hello'` to the list in `src/plugins/known.js`. Reload the page.

## 2. The manifest

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiVersion": 1,
  "activation": "onAction",
  "defaultEnabled": true,
  "icons": { "greeting": "icons/greeting.svg" },
  "contributes": {
    "trackActions": [{ "id": "say", "label": "action.say", "icon": "icons/hello.svg" }],
    "exportTransforms": [{ "id": "stamp" }]
  }
}
```

| Field | Meaning |
|---|---|
| `id` | must equal the folder name |
| `apiVersion` | must be `1`; a plugin for another version is refused with a clear message |
| `activation` | `onAction` (load code on first use, default for menu plugins) or `onStartup` |
| `defaultEnabled` | `false` makes the plugin opt-in |
| `icons` | named SVGs the plugin uses itself; read them with `ctx.icon(name)` |
| `contributes.trackActions` | menu entries, shown **before** the plugin code loads; `label` is a key in the plugin's locale file, `icon` a path to an SVG |
| `contributes.exportTransforms` | declares that the plugin transforms tracks when saving, so the host activates it before every save |

Icons are plain SVG with `stroke="currentColor"` on a 24x24 view box so they follow the theme. Scripts, links and
event handlers in an SVG are stripped.

## 3. The code

`index.js` is an ES module:

```js
export function activate(ctx) {
  ctx.ui.registerTrackAction({
    id: 'say',
    label: 'action.say',
    run({ trackId }) {
      const track = ctx.tracks.get(trackId);
      const ext = track.ext;                  // plugin data lives here (shared, mutate only inside commands)
      const before = ext.greeted;
      ctx.exec({
        label: 'Greet track',
        do:   () => { ext.greeted = true; },
        undo: () => { ext.greeted = before; },
      });
      ctx.ui.toast(ctx.i18n.t('toast.done', { name: track.callsign }));
    },
  });
}

export function deactivate() {}               // optional; the host removes everything you registered
```

`activate` may be async. If it throws, the plugin is switched off and everything it registered so far is removed.

## 4. Strings

`locales/en.json` is required (it is the fallback); add `de.json`. Keys are plain, values may contain `{placeholders}`:

```json
{ "action.say": "Say hello", "toast.done": "{name} says hello." }
```

`ctx.i18n.t('toast.done', { name })` looks the key up in your files. Everything the user sees or hears must go through
it: text, tooltips, aria-labels and toasts. Placeholders are substituted as they are, so word sentences around a plain
noun or number. German uses the informal "du".

## 5. The Host API (`ctx`)

```
ctx.id, ctx.apiVersion
ctx.exec(command)                              the only way to change data; command = { label, do(), undo() }
ctx.icon(name)                                 SVG text of an icon declared in the manifest, or ''
ctx.i18n.t(key, params)
ctx.time.get() / ctx.time.set(seconds)         the playhead, in project time
ctx.selection.get()                            the selected track id or null

ctx.tracks.list() / ctx.tracks.get(id)         read-only copies; track.ext is the live plugin-data object
ctx.tracks.registerDragGuard(fn(track))        return false to forbid moving the track
ctx.tracks.registerRange(fn(track))            return { startS, endS } (track time) = the part to show and save, or null
ctx.tracks.clip(track, startS, endS)           a copy cut to the range, variable state seeded at the start; null if empty

ctx.ui.registerTrackAction({ id, label, run({ trackId }) })
ctx.ui.registerTimelineLayer({ draw(g, { track, top, height, width, toX }) })
ctx.ui.openDialog(spec)                        floating non-modal dialog; returns { setValues(v), close() }
ctx.ui.requestRedraw()                         ask the views to redraw after a change in your own draft state
ctx.ui.toast(message)

ctx.io.registerExportTransform({ id, order, apply(tracks) })   order: lowest first, default 100
ctx.io.registerFormat(spec)                    see src/formats/registry.js

ctx.shortcuts.register({ id, key, primary, shift, allowInTyping, run })
```

Every callback you pass is wrapped in try/catch by the host: an exception is reported in the console and ignored for
that call. Everything you register is removed automatically when the plugin is switched off or fails.

### Time

- **Track time** is the time stored in the recording. **Project time** is track time plus the track's
  `timeOffsetS`: what the timeline shows and what the playhead (`ctx.time`) uses.
- `registerRange` returns **track time**. A timeline layer's `toX(trackTimeS)` takes track time and returns the x
  position in the row, offset included.
- In an export transform the tracks are already in **project time**, so `ctx.tracks.clip(track, startS, endS)` takes
  project time there: add `track.timeOffsetS` to a stored track-time value first (trim does exactly this).

### Timeline layers

`draw(g, ctx)` gets a 2D canvas context, the track, the row's `top` and `height`, the canvas `width` and `toX`.
The canvas is shared by all rows, so stay inside your row. Use neutral or theme-friendly colours; the app is used in
light and dark themes.

### Export transforms

`apply(tracks)` runs when saving, on **copies** with project time already applied and the part before 00:00 already
cut. Return the tracks to save (drop a track by leaving it out). After all transforms the earliest frame is moved to
time 0. The live project is never modified by saving.

### Dialogs

```js
const dlg = ctx.ui.openDialog({
  title: 'Trim: D-ABCD',
  summary: (v) => 'Keeping **' + v.start + ' - ' + v.end + '**',       // **bold** parts are emphasised
  range: { startId: 'start', endId: 'end', min: 0, max: 14.8, step: 0.1, startLabel: 'Start', endLabel: 'End' },
  fields: [
    { id: 'start', type: 'time', hidden: true, label: 'Start', value: 0 },   // type 'time' shows hh:mm:ss
    { id: 'end',   type: 'time', hidden: true, label: 'End',   value: 14.8 },
  ],
  actions: [{ id: 'startHere', icon: ctx.icon('startHere'), label: 'Start = playhead' }],
  buttons: [
    { id: 'reset',  label: 'Reset',  quiet: true },     // quiet buttons sit on the left
    { id: 'cancel', label: 'Cancel' },
    { id: 'apply',  label: 'Apply', primary: true },
  ],
  onChange(values) { /* live draft */ },
  onButton(id, values) { /* 'apply', 'cancel', ... */ },
});
```

The dialog is **non-modal** so the timeline and playhead stay usable. The ×, **Esc** and any click that you map to
`cancel` should discard the draft; **Apply** should store the result with one `ctx.exec` command. Only one dialog is
open at a time; opening another closes the first. Close yours with `dlg.close()`.

## 6. Test it

`test/helpers/fake-host.js` runs a real plugin folder under `node --test` with the app replaced by recorders:

```js
import { loadPlugin, makeTrack } from '../../../test/helpers/fake-host.js';

test('hello: greeting is undoable', async () => {
  const track = makeTrack();
  const h = await loadPlugin('hello', { tracks: [track], locale: 'de' });
  await h.host.runTrackAction('hello', 'say', 't1');
  assert.equal(track.ext.greeted, true);
  h.history.undo();
  assert.equal(track.ext.greeted, undefined);
});
```

The helper returns the host, the history, the toasts and warnings, and the registered guards, layers, ranges and
dialogs, so a test can drive a dialog (`h.lastDialog().spec.onButton('apply')`) and inspect the result. Run
everything with `npm test`.

## Checklist

- [ ] folder name = manifest `id`; id added to `src/plugins/known.js`
- [ ] changes only through `ctx.exec`, with a working `undo`
- [ ] all text through `ctx.i18n.t`, `en` and `de` files with identical keys
- [ ] icons use `currentColor`; touch targets at least 44 px; every drag has a button or key alternative
- [ ] `Esc` cancels a dialog without saving
- [ ] tests with the fake host; a README in the plugin folder
