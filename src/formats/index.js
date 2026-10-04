// The app's format registry with the built-in formats registered. Import this, not the individual modules.

import { FormatRegistry } from './registry.js';
import { jfsLegacyFormat } from './jfs-legacy.js';
import { gpxFormat } from './gpx.js';

export const formats = new FormatRegistry();
formats.register(jfsLegacyFormat);
formats.register(gpxFormat);

export { FormatRegistry } from './registry.js';
