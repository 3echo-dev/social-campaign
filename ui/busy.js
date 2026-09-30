/**
 * Select the card named by a durable busy state after a redraw or reconnect.
 * With several cards and no target, the top status bar carries progress alone.
 * @param {HTMLElement} container
 * @param {{screenId?: string, targetId?: string|null}} busy
 * @param {string} screenId
 * @returns {HTMLElement|null}
 */
export function busyCard(container, busy, screenId) {
  if (busy.screenId && busy.screenId !== screenId) return null;
  const cards = Array.from(container.querySelectorAll('.card, .panel'))
    .filter(card => !card.querySelector(':scope .card, :scope .panel'));
  if (Object.prototype.hasOwnProperty.call(busy, 'targetId')) {
    return busy.targetId ? cards.find(card => card.id === busy.targetId) ?? null : null;
  }
  return cards.length === 1 ? cards[0] : null;
}
