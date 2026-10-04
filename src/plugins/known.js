// The first-party plugins this build knows about (PLAN-v2.md §3.5). The host tries to load every one of them;
// a plugin whose folder is not delivered (or that fails) is simply skipped, so a slim build just deletes folders.
// Adding a plugin = add `plugins/<id>/` and its id here (test/plugins.test.js checks that no folder is forgotten).
export const KNOWN_PLUGINS = [];
