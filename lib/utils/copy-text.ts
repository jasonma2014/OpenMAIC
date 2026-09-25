/**
 * Copy `text` during a click.
 *
 * `navigator.clipboard.writeText` rejects with NotAllowedError when the
 * document is not focused, and that rejection arrives on a later turn. The
 * selection copy has to run in this same turn, while the click is still a user
 * gesture, and the field has to live inside the open dialog: the rest of the
 * page is inert.
 */
export function copyPlainText(
  text: string,
  field: HTMLInputElement | HTMLTextAreaElement | null,
): Promise<boolean> {
  const commandCopied = field ? copyField(field) : false;
  const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  if (!write) return Promise.resolve(commandCopied);
  return write(text).then(
    () => true,
    () => commandCopied,
  );
}

function copyField(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  field.focus();
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
