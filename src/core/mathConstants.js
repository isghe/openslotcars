/** Named finite numbers, without expression evaluation or JavaScript access. */
export function parseMathConstants(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('math.json: expected an object of numeric constants');
  }
  for (const [name, number] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !Number.isFinite(number)) {
      throw new TypeError(`math.json.${name}: expected an uppercase name and a finite number`);
    }
  }
  return Object.freeze({ ...value });
}

export function resolveNumber(value, constants, path) {
  if (typeof value === 'string' && /^Math\.[A-Z][A-Z0-9_]*$/.test(value)) {
    const name = value.slice(5);
    if (!Object.hasOwn(constants, name)) throw new TypeError(`${path}: unknown constant ${value}`);
    value = constants[name];
  }
  if (!Number.isFinite(value)) throw new TypeError(`${path}: expected a finite number or a known Math constant`);
  return value;
}
