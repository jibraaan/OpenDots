import { expect, it } from 'vitest';
import { shouldSubmitOnEnter } from '../src/client/composer';
const key = (
  key: string,
  { shiftKey = false, isComposing = false, keyCode = 13 } = {},
) => ({ key, shiftKey, nativeEvent: { isComposing, keyCode } });
it('sends on a plain Enter', () => {
  expect(shouldSubmitOnEnter(key('Enter'))).toBe(true);
});
it('keeps Shift+Enter as a newline', () => {
  expect(shouldSubmitOnEnter(key('Enter', { shiftKey: true }))).toBe(false);
});
it('leaves Enter to the IME while composition is active', () => {
  expect(shouldSubmitOnEnter(key('Enter', { isComposing: true }))).toBe(false);
  // Safari dispatches the confirming keydown after compositionend.
  expect(shouldSubmitOnEnter(key('Enter', { keyCode: 229 }))).toBe(false);
});
it('ignores other keys', () => {
  expect(shouldSubmitOnEnter(key('a'))).toBe(false);
});
