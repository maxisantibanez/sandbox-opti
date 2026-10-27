const numberFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 4,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(Object.is(value, -0) ? 0 : value);
}
