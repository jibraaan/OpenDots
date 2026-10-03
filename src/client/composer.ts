export type ComposerKey = {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
};
// Enter sends, Shift+Enter inserts a newline, and Enter that confirms an IME
// candidate stays with the IME. Safari reports the confirming keydown after
// compositionend, so keyCode 229 is the only reliable signal there.
export function shouldSubmitOnEnter(e: ComposerKey) {
  return (
    e.key === 'Enter' &&
    !e.shiftKey &&
    !e.nativeEvent.isComposing &&
    e.nativeEvent.keyCode !== 229
  );
}
