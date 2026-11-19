/**
 * The menu that chooses the circuit.
 *
 * The options come from the list of circuits, so the menu cannot offer one that
 * does not exist. The page is told about each choice through `onChange`.
 *
 * Game keys are ignored while a menu has the focus (it needs the arrows and
 * Space itself), so a menu left focused would take the throttle away from the
 * game. After a choice made with the mouse or a finger the focus is therefore
 * given back to the page, as for the buttons; after a choice made with the
 * keyboard it stays, because the player is still moving through the menu.
 *
 * The document is a parameter (it defaults to the real one), so the behavior
 * can be tested in Node with simple stand-ins.
 */

/**
 * @param {{select: HTMLSelectElement, circuits: Array<{id: string, name: string}>,
 *   selectedId: string, onChange: function(string): void,
 *   documentTarget?: {createElement: function(string): object}}} options
 */
export function bindCircuitSelect({
  select,
  circuits,
  selectedId,
  onChange,
  documentTarget = document,
}) {
  for (const circuit of circuits) {
    const option = documentTarget.createElement('option');
    option.value = circuit.id;
    option.textContent = circuit.name;
    select.append(option);
  }
  select.value = selectedId;

  let usesKeyboard = false;
  select.addEventListener('keydown', () => {
    usesKeyboard = true;
  });
  select.addEventListener('pointerdown', () => {
    usesKeyboard = false;
  });
  select.addEventListener('change', () => {
    onChange(select.value);
    if (!usesKeyboard) select.blur();
  });
}
