// Synthetic Track builder for codec/project-model tests.

export function buildSyntheticTrack({ id = 't1', callsign = 'TEST01', frameCount = 50, startTime = 0, withLivery = false } = {}) {
  const times = new Float64Array(frameCount);
  const types = new Uint8Array(frameCount).fill(1);
  const lat = new Float64Array(frameCount);
  const lon = new Float64Array(frameCount);
  const alt = new Float64Array(frameCount);
  const pitch = new Float32Array(frameCount);
  const bank = new Float32Array(frameCount);
  const heading = new Float32Array(frameCount);
  const vX = new Float32Array(frameCount);
  const vY = new Float32Array(frameCount);
  const vZ = new Float32Array(frameCount);
  const elevation = new Float32Array(frameCount);
  const staticCgToGround = new Float32Array(frameCount);
  const groundFlags = new Uint8Array(frameCount);
  const opaquePayload = new Array(frameCount).fill(null);

  for (let i = 0; i < frameCount; i++) {
    times[i] = startTime + i * 0.05;
    lat[i] = 48.9 + i * 0.001;
    lon[i] = 9.45 + i * 0.001;
    alt[i] = 300 + i * 5;
    heading[i] = (90 + i) % 360;
    vX[i] = 50; vY[i] = 1; vZ[i] = 50;
    elevation[i] = 300;
    groundFlags[i] = i < 3 ? 1 : 0;
    staticCgToGround[i] = 1.5;
  }

  return {
    id, sourceFileName: 'synthetic.jfs',
    plane: true, callsign, nickname: 'Test Pilot', model: 'Cessna 172',
    typeRole: 1, icaoType: 'C172', icaoAirline: '',
    livery: withLivery ? 'White/Blue' : '',
    detectedBuildVariant: withLivery ? 'fs2024' : 'other', sourceVersion: 21008,
    timeOffsetS: 0, visible: true, showAltitude: true, showSpeed: true, showEvents: true, color: '#4e79a7',
    frames: { times, types, lat, lon, alt, pitch, bank, heading, vX, vY, vZ, elevation, staticCgToGround, groundFlags, opaquePayload },
    events: [],
  };
}
