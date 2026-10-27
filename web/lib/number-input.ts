const EDITABLE_NUMBER =
  /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** Text representation for an editable number: no grouping, comma decimal. */
export function formatEditableNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }

  return String(value).replace(".", ",");
}

/**
 * Parse an in-progress numeric draft. Returns null while the text is not yet a
 * complete finite number, so the caller can preserve the previous model value.
 */
export function parseEditableNumber(text: string): number | null {
  const normalized = text.trim().replace(/,/g, ".");

  if (!EDITABLE_NUMBER.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
