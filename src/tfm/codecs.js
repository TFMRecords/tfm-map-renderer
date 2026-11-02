// The conversions the game applies to attribute strings (docs/xml/values.md#conversions; the names there are
// `int`, `number`, `number0`, `float` and `hex`). Centralized so tests can pin the exact Flash behaviour.

// JS Number() accepts 0b/0o literals; AS3 Number()/int() follow the ES3 string grammar
// (decimal, 0x hex, Infinity) and give NaN for them.
const NON_ES3_PREFIX = /^[\s\u00a0\ufeff]*0[bBoO]/;

/**
 * The `number` conversion, AS3 `Number(s)`: `undefined` -> `NaN`, `""` -> 0, hex and `Infinity` accepted, JS-only `0b11` / `0o7` / `1_000` -> `NaN`.
 */
export function as3Number(value) {
  if (value === undefined) return Number.NaN;
  if (typeof value === "string" && NON_ES3_PREFIX.test(value)) return Number.NaN;
  return Number(value);
}

/**
 * The `number0` conversion (docs/xml/values.md#conversions): `Number(s)` with `NaN` replaced by 0 (infinities kept).
 */
export function as3NumberOrZero(value) {
  const number = as3Number(value);
  return Number.isNaN(number) ? 0 : number;
}

/**
 * The `int` conversion, AS3 `int(s)`: truncates toward zero, wraps modulo 2^32, `NaN`/`undefined`/`"abc"` -> 0, hex accepted.
 */
export function as3Int(value) {
  const number = as3Number(value);
  if (!Number.isFinite(number) || number === 0) return 0;
  // AS3 int is a signed 32-bit integer conversion.
  return number >> 0;
}

/**
 * The `float` conversion, AS3 `parseFloat(s)`; `undefined` -> `NaN`.
 */
export function as3ParseFloat(value) {
  if (value === undefined) return Number.NaN;
  return Number.parseFloat(String(value));
}

/**
 * AS3 `parseInt(s, radix)` (with radix 16, the `hex` conversion); `undefined` -> `NaN`; `parseInt("0x10", 10)` is 0.
 */
export function as3ParseInt(value, radix = 10) {
  if (value === undefined) return Number.NaN;
  return Number.parseInt(String(value), radix);
}

/**
 * The `truthy` test, AS3 truthiness of a string: `""` false, `"0"` true.
 */
export function as3Truthy(value) {
  return Boolean(value);
}

export function split(value, separator) {
  return String(value).split(separator);
}
