/** Pure helpers for BlastTab — module scope, no React import. */
import type { PrBlastSymbol } from "@devdigest/shared";

export interface SymbolFileGroup {
  file: string;
  symbols: PrBlastSymbol[];
}

/** changed_symbols already arrives sorted file ASC/name ASC/kind ASC from the
 *  server (compareChangedSymbols) — this is a contiguity scan, not a re-sort,
 *  so it preserves that order exactly. Object.groupBy is NOT available here:
 *  client/tsconfig.json's lib is ES2022, Object.groupBy is ES2024. */
export function groupSymbolsByFile(symbols: readonly PrBlastSymbol[]): SymbolFileGroup[] {
  const groups: SymbolFileGroup[] = [];
  for (const symbol of symbols) {
    const last = groups[groups.length - 1];
    if (last && last.file === symbol.file) last.symbols.push(symbol);
    else groups.push({ file: symbol.file, symbols: [symbol] });
  }
  return groups;
}

/** percentile 100 → "top 1%" (never "top 0%"), 60 → "top 40%". */
export function topPercentLabel(percentile: number): number {
  return Math.max(1, 100 - Math.round(percentile));
}
