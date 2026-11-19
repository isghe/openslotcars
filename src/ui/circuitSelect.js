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
 * Finds the circuit asked for by the `circuit` argument of the page address
 * (`?circuit=chicane`). The value is matched with the identifier or the name of
 * a circuit, ignoring case and the spaces around it. An address without the
 * argument, with an empty value or with a circuit that does not exist gives the
 * fallback, so a wrong address never stops the game from starting. When the
 * argument appears more than once, the first one counts.
 * @param {string} search The query string of the address, with or without `?`.
 * @param {Array<{id: string, name: string}>} circuits
 * @param {{id: string, name: string}} fallback
 */
export function circuitFromSearch(search, circuits, fallback) {
  const wanted = new URLSearchParams(search).get('circuit')?.trim().toLowerCase();
  if (!wanted) return fallback;
  return (
    circuits.find((circuit) => circuit.id === wanted || circuit.name.toLowerCase() === wanted) ??
    fallback
  );
}

/**
 * The page address with the `circuit` argument set to a circuit, so that after
 * a choice made from the menu the address names the circuit on the screen. (The
 * address of a page that has just opened is not changed.) The other arguments
 * and the fragment are kept; a repeated `circuit` argument becomes a single one.
 * @param {string} href The current address of the page.
 * @param {string} id Identifier of the circuit.
 * @returns {string}
 */
export function addressWithCircuit(href, id) {
  const address = new URL(href);
  address.searchParams.set('circuit', id);
  return address.href;
}

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
