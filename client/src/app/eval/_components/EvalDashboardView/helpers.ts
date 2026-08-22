/** Selecting the already-selected agent again clears the filter (D21). */
export function toggleAgentSelection(current: string | null, id: string): string | null {
  return current === id ? null : id;
}
