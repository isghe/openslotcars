const PARAMETERS = { curbs: 'curbs', curveMarkers: 'curve-markers' };

export function displayOptionsFromSearch(search) {
  const params = new URLSearchParams(search);
  return {
    curbs: (params.get(PARAMETERS.curbs) ?? '1') === '1',
    curveMarkers: (params.get(PARAMETERS.curveMarkers) ?? '1') === '1',
  };
}

export function addressWithDisplayOption(href, option, enabled) {
  const address = new URL(href);
  address.searchParams.set(PARAMETERS[option], enabled ? '1' : '0');
  return address.href;
}

export function bindDisplayMenu({ menu, button, panel }) {
  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  button.addEventListener('click', (event) => {
    const open = panel.hidden;
    setOpen(open);
    // After a pointer closes the panel, Space belongs to the game again.
    if (!open && event.detail !== 0) button.blur();
  });

  menu.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.focus();
  });
}
