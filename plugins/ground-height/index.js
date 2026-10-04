// Ground height: looks the terrain height up along a track (through the <joinfs-ground-height> component in vendor/, which asks
// open-meteo.com for a thinned-out set of the track's positions), shows it in the track's ALT lane on the timeline, and opens a
// large zoomable diagram of altitude vs. ground height for one aircraft. State lives in `track.ext.groundHeight =
// { profile, shown }` (not saved into the recording); every change goes through ctx.exec, so it is undoable. The looked-up
// profile stays cached on the track, so toggling again does not ask the service again.

const LIB_URL = new URL('./vendor/joinfs-ground-height.js', import.meta.url).href;

/** Advanced / tests: `provider(batch) -> Promise<number[]>` replaces the open-meteo.com lookup. */
export const options = { provider: undefined };

let libPromise = null;
/** Loads the vendored component once (a classic script in the page, a plain import under node) and resolves its API. */
function loadLib() {
  if (globalThis.JoinfsGroundHeight) return Promise.resolve(globalThis.JoinfsGroundHeight);
  if (!libPromise) {
    const loaded = typeof document !== 'undefined'
      ? new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = LIB_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`could not load ${LIB_URL}`));
        document.head.appendChild(script);
      })
      : import(LIB_URL);
    libPromise = loaded.then(() => {
      if (!globalThis.JoinfsGroundHeight) throw new Error('the component did not define JoinfsGroundHeight');
      return globalThis.JoinfsGroundHeight;
    }).catch((err) => { libPromise = null; throw err; });
  }
  return libPromise;
}

const validFix = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

/** Altitude series of the frames that carry a position (events and variables share the arrays with zeros), in project time. */
function altitudeSeries(track) {
  const f = track.frames;
  const keep = [];
  for (let i = 0; i < f.times.length; i++) if (validFix(f.lat[i], f.lon[i])) keep.push(i);
  return {
    times: Float64Array.from(keep, (i) => f.times[i] + track.timeOffsetS),
    alt: Float64Array.from(keep, (i) => f.alt[i]),
  };
}

export function activate(ctx) {
  const running = new Set();                       // track ids with a lookup in progress
  const profileOf = (track) => track.ext && track.ext.groundHeight && track.ext.groundHeight.profile;
  const nameOf = (track) => track.callsign || track.id;

  ctx.ui.registerTimelineLayer({
    draw(g, { track, top, height, width, toX, altitudeY }) {
      const gh = track.ext && track.ext.groundHeight;
      if (!gh || !gh.shown || !gh.profile || !altitudeY) return;      // altitudeY is null while the ALT lane is off
      const { times, height: h } = gh.profile;
      const lo = top + 2, hi = top + height - 2;                      // the lane
      const clampY = (y) => Math.min(hi, Math.max(lo, y));
      g.beginPath();
      g.rect(0, top, width, height);
      g.clip();
      g.beginPath();
      let started = false, firstX = 0, lastX = 0;
      for (let i = 0; i < times.length; i++) {
        const x = toX(times[i]);
        if (x < -60 && i + 1 < times.length && toX(times[i + 1]) < -60) continue;     // far left of the view
        const y = clampY(altitudeY(h[i]));
        if (!started) { g.moveTo(x, y); firstX = x; started = true; } else g.lineTo(x, y);
        lastX = x;
        if (x > width + 60) break;
      }
      if (!started) return;
      g.strokeStyle = 'rgba(184,134,63,.95)';                         // earth brown, readable on the light and the dark theme
      g.lineWidth = 1.5;
      g.stroke();
      g.lineTo(lastX, hi); g.lineTo(firstX, hi); g.closePath();
      g.fillStyle = 'rgba(160,120,70,.40)';
      g.fill();
    },
  });

  function setGround(trackId, next, label) {
    const track = ctx.tracks.get(trackId);
    if (!track) return;
    const ext = track.ext;                                            // the live object
    const before = ext.groundHeight;
    // undo of the very first lookup keeps the cache (hidden), so show / hide / undo never asks the service twice
    const undoTo = before || { profile: next.profile, shown: false };
    ctx.exec({
      label,
      do: () => { ext.groundHeight = next; },
      undo: () => { ext.groundHeight = undoTo; },
    });
  }

  /** The cached profile, or a fresh lookup (with toasts); null when it failed or is already running. */
  async function ensureProfile(track) {
    const cached = profileOf(track);
    if (cached) return cached;
    if (running.has(track.id)) { ctx.ui.toast(ctx.i18n.t('toast.busy', { name: nameOf(track) })); return null; }
    running.add(track.id);
    try {
      let lib;
      try { lib = await loadLib(); } catch (err) {
        console.warn('Ground height component not loaded:', err);
        ctx.ui.toast(ctx.i18n.t('toast.noLibrary'));
        return null;
      }
      ctx.ui.toast(ctx.i18n.t('toast.looking', { name: nameOf(track) }));
      try {
        return await lib.computeProfile(track.frames, { provider: options.provider });
      } catch (err) {
        const code = err && err.code;
        const known = ['network', 'http', 'rateLimited', 'badResponse', 'noPositions'];
        if (!known.includes(code)) console.warn('Ground height lookup failed:', err);
        ctx.ui.toast(ctx.i18n.t(`toast.error.${known.includes(code) ? code : 'other'}`, { name: nameOf(track) }));
        return null;
      }
    } finally {
      running.delete(track.id);
    }
  }

  async function toggle(trackId) {
    const track = ctx.tracks.get(trackId);
    if (!track) return;
    const gh = track.ext.groundHeight;
    if (gh && gh.profile) {
      setGround(trackId, { profile: gh.profile, shown: !gh.shown }, gh.shown ? 'Hide ground height' : 'Show ground height');
      ctx.ui.toast(ctx.i18n.t(gh.shown ? 'toast.hidden' : (track.showAltitude === false ? 'toast.shownNoLane' : 'toast.shown'), { name: nameOf(track) }));
      return;
    }
    const profile = await ensureProfile(track);
    if (!profile || !ctx.tracks.get(trackId)) return;                 // failed, or the track was removed meanwhile
    setGround(trackId, { profile, shown: true }, 'Show ground height');
    ctx.ui.toast(ctx.i18n.t(track.showAltitude === false ? 'toast.shownNoLane' : 'toast.shown', { name: nameOf(track) }));
  }

  async function openProfile(trackId) {
    const track = ctx.tracks.get(trackId);
    if (!track) return;
    const profile = await ensureProfile(track);
    if (!profile || !ctx.tracks.get(trackId)) return;
    if (!profileOf(track)) setGround(trackId, { profile, shown: false }, 'Look up ground height');
    const offset = track.timeOffsetS || 0;
    const series = altitudeSeries(track);
    const chart = document.createElement('joinfs-ground-profile');
    chart.setAttribute('lang', ctx.i18n.locale);
    chart.addEventListener('seek', (e) => ctx.time.set(e.detail.time));
    chart.data = {
      name: nameOf(track),
      times: series.times,
      alt: series.alt,
      ground: { times: Float64Array.from(profile.times, (t) => t + offset), height: profile.height },
    };
    chart.playhead = ctx.time.get();
    const modal = ctx.ui.openModal({ title: ctx.i18n.t('modal.title', { name: nameOf(track) }) });
    modal.body.appendChild(chart);
  }

  ctx.ui.registerTrackAction({
    id: 'toggle',
    label: 'action.toggle',
    run({ trackId }) { return toggle(trackId).catch((err) => console.warn('Ground height toggle failed:', err)); },
  });
  ctx.ui.registerTrackAction({
    id: 'profile',
    label: 'action.profile',
    run({ trackId }) { return openProfile(trackId).catch((err) => console.warn('Ground profile failed:', err)); },
  });
}
