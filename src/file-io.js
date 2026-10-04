// File System Access API wrappers, with <input type=file>/Blob-download fallback for browsers
// that don't support it (Firefox/Safari) - see PLAN.md/REQUIREMENTS.md "File I/O".

export const hasFileSystemAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

const JFS_TYPES = [{ description: 'JoinFS recording', accept: { 'application/octet-stream': ['.jfs'] } }];

/**
 * Opens a file picker for the given extensions (the formats registry's importable ones, e.g. ['.jfs', '.gpx']);
 * returns [{ file, handle }] (handle is null in the fallback path).
 */
export async function pickFilesToOpen(extensions = ['.jfs', '.gpx']) {
  if (hasFileSystemAccess) {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: 'Recordings and tracks', accept: { 'application/octet-stream': extensions } }],
      excludeAcceptAllOption: false,
    });
    const out = [];
    for (const handle of handles) out.push({ file: await handle.getFile(), handle });
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.join(',');
    input.multiple = true;
    input.addEventListener('change', () => {
      resolve(Array.from(input.files || []).map((file) => ({ file, handle: null })));
    }, { once: true });
    input.click();
  });
}

/**
 * Saves `bytes` (Uint8Array) as a .jfs file. If the File System Access API is available, prompts
 * for a save location (or writes back to `suggestedHandle` when the caller already has one open -
 * not currently used, since a project has no single "current file"). Otherwise triggers a browser
 * download via a Blob URL.
 */
export async function saveJfsFile(bytes, suggestedName = 'project.jfs') {
  if (hasFileSystemAccess) {
    const handle = await window.showSaveFilePicker({ suggestedName, types: JFS_TYPES });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { savedVia: 'fsAccess', handle };
  }
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { savedVia: 'download' };
}
