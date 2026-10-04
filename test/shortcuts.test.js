import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingContext, Shortcuts } from '../src/shortcuts.js';

// minimal DOM stand-ins: the logic only reads nodeType/tagName/getAttribute/isContentEditable/open
const el = (tagName, extra = {}) => ({
  nodeType: 1, tagName, isContentEditable: false, getAttribute: (n) => (extra.attrs || {})[n] ?? null, ...extra,
});
const ev = (key, path, extra = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false,
  target: path[path.length - 1], composedPath: () => path, preventDefault() { this.defaultPrevented = true; }, ...extra,
});

test('a plain element is not a typing context', () => {
  assert.equal(isTypingContext(ev(' ', [el('DIV'), el('BODY')])), false);
});

test('input, textarea, select and contenteditable are typing contexts', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isTypingContext(ev(' ', [el(tag), el('DIV')])), true);
  assert.equal(isTypingContext(ev(' ', [el('DIV', { isContentEditable: true })])), true);
  assert.equal(isTypingContext(ev(' ', [el('DIV', { attrs: { role: 'textbox' } })])), true);
});

test('an input inside nested shadow roots is found through the composed path, although target is the outer host', () => {
  const input = el('INPUT');
  const host = el('DIV'); // what event.target is after retargeting to the outermost shadow host
  const e = ev(' ', [input, el('DIV'), el('JOINFS-GPX-TO-JFS'), el('DIV'), host, el('BODY')], { target: host });
  assert.equal(host.tagName, 'DIV');
  assert.equal(isTypingContext(e), true);
});

test('anything inside an open modal dialog is a typing context, a closed one is not', () => {
  assert.equal(isTypingContext(ev(' ', [el('DIV'), el('DIALOG', { open: true })])), true);
  assert.equal(isTypingContext(ev(' ', [el('DIV'), el('DIALOG', { open: false })])), false);
});

test('buttons own Space and Enter but not other keys', () => {
  assert.equal(isTypingContext(ev(' ', [el('BUTTON')])), true);
  assert.equal(isTypingContext(ev('Enter', [el('A')])), true);
  assert.equal(isTypingContext(ev('l', [el('BUTTON')])), false);
});

test('IME composition is always a typing context', () => {
  assert.equal(isTypingContext(ev('a', [el('DIV')], { isComposing: true })), true);
});

test('registry: Space toggles outside inputs and is left alone inside them', () => {
  const sc = new Shortcuts();
  let toggles = 0;
  sc.register({ key: ' ', run: () => { toggles++; } });
  const outside = ev(' ', [el('DIV'), el('BODY')]);
  assert.equal(sc.handle(outside), true);
  assert.equal(outside.defaultPrevented, true);
  const inside = ev(' ', [el('INPUT'), el('DIV'), el('DIV')], { target: el('DIV') });
  assert.equal(sc.handle(inside), false);
  assert.equal(inside.defaultPrevented, false, 'typing a space must not be cancelled');
  assert.equal(toggles, 1);
});

test('registry: chords marked allowInTyping work in inputs but never inside a modal', () => {
  const sc = new Shortcuts();
  let saves = 0;
  sc.register({ key: 's', primary: true, allowInTyping: true, run: () => { saves++; } });
  assert.equal(sc.handle(ev('s', [el('INPUT')], { ctrlKey: true })), true);
  assert.equal(sc.handle(ev('s', [el('INPUT'), el('DIALOG', { open: true })], { ctrlKey: true })), false);
  assert.equal(saves, 1);
});

test('registry: modifier state must match, and unregister removes the shortcut', () => {
  const sc = new Shortcuts();
  let n = 0;
  const off = sc.register({ key: 'l', preventDefault: false, run: () => { n++; } });
  assert.equal(sc.handle(ev('l', [el('DIV')], { ctrlKey: true })), false);
  assert.equal(sc.handle(ev('L', [el('DIV')], { shiftKey: true })), true);
  off();
  assert.equal(sc.handle(ev('l', [el('DIV')])), false);
  assert.equal(n, 1);
});

test('plus and minus zoom shortcuts match with or without Shift, but leave Ctrl+plus to the browser', () => {
  const sc = new Shortcuts();
  let zoom = 0;
  sc.register({ key: '+', run: () => { zoom++; } });
  assert.equal(sc.handle(ev('+', [el('DIV')], { shiftKey: true })), true); // US layout: + needs Shift
  assert.equal(sc.handle(ev('+', [el('DIV')])), true);                      // number pad
  assert.equal(sc.handle(ev('+', [el('DIV')], { ctrlKey: true })), false);  // browser page zoom
  assert.equal(sc.handle(ev('+', [el('INPUT')])), false);                   // typing
  assert.equal(zoom, 2);
});
