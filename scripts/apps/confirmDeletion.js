export async function confirmDeletion(messageKey, {
  dialogProvider = () => globalThis.foundry?.applications?.api?.DialogV2,
  localize = key => globalThis.game?.i18n?.localize?.(key) ?? key
} = {}) {
  const dialog = dialogProvider();
  if (!dialog?.confirm) return false;
  return (await dialog.confirm({
    content: `<p>${localize(messageKey)}</p>`,
    rejectClose: false,
    modal: true
  })) === true;
}
