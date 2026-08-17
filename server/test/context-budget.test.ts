/**
 * modules/context/helpers.ts — applyBudget (U5, run injection plan). Hermetic
 * unit test, no I/O: entries carry pre-computed token counts (a stub — the
 * real tokenizer's own counting is exercised elsewhere).
 *
 * Pins AC-24: entries fitting exactly at the budget are all kept; the FIRST
 * entry that would exceed it, and EVERY later entry (even a tiny one), is
 * excluded with `over_budget`; a kept entry's text is never truncated; a
 * single document larger than the whole budget is excluded entirely with
 * nothing kept after it.
 */
import { describe, it, expect } from 'vitest';
import { applyBudget, type BudgetableEntry } from '../src/modules/context/helpers.js';

function entry(path: string, tokens: number, text = `text-of-${path}`): BudgetableEntry {
  return { path, text, tokens };
}

describe('applyBudget', () => {
  it('keeps every entry when the running total lands exactly on the budget', () => {
    const entries = [entry('a.md', 40), entry('b.md', 60)];
    const { kept, excluded } = applyBudget(entries, 100);

    expect(kept).toEqual([
      { path: 'a.md', text: 'text-of-a.md' },
      { path: 'b.md', text: 'text-of-b.md' },
    ]);
    expect(excluded).toEqual([]);
  });

  it('excludes the first entry that would exceed the budget AND every later entry, even a tiny one', () => {
    // a.md (50) fits. b.md (40) would push the total to 90 > 80 — excluded.
    // c.md (1) is tiny but still excluded, purely because it comes after b.md.
    const entries = [entry('a.md', 50), entry('b.md', 40), entry('c.md', 1)];
    const { kept, excluded } = applyBudget(entries, 80);

    expect(kept.map((k) => k.path)).toEqual(['a.md']);
    expect(excluded).toEqual([
      { path: 'b.md', reason: 'over_budget' },
      { path: 'c.md', reason: 'over_budget' },
    ]);
  });

  it('never truncates a kept entry\'s text', () => {
    const longText = 'x'.repeat(5000);
    const entries = [entry('long.md', 10, longText)];
    const { kept } = applyBudget(entries, 10_000);

    expect(kept).toHaveLength(1);
    expect(kept[0]!.text).toBe(longText);
    expect(kept[0]!.text.length).toBe(5000);
  });

  it('excludes a single document larger than the whole budget entirely, keeping nothing after it', () => {
    const entries = [entry('huge.md', 20_001), entry('small.md', 1)];
    const { kept, excluded } = applyBudget(entries, 20_000);

    expect(kept).toEqual([]);
    expect(excluded).toEqual([
      { path: 'huge.md', reason: 'over_budget' },
      { path: 'small.md', reason: 'over_budget' },
    ]);
  });
});
