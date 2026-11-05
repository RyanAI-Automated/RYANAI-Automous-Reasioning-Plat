import { describe, expect, it } from 'vitest';
import {
  BANK_CATEGORY_LABELS,
  SOUTH_AFRICAN_BANKS,
  SOUTH_AFRICAN_BANK_SOURCE,
} from './southAfricanBanks';

describe('South African bank catalogue', () => {
  it('contains the current CODI member-bank categories used by the trading wallet', () => {
    expect(SOUTH_AFRICAN_BANKS).toHaveLength(34);
    expect(new Set(SOUTH_AFRICAN_BANKS.map((bank) => bank.category))).toEqual(
      new Set(['commercial', 'foreign_branch', 'cooperative', 'mutual']),
    );
  });

  it('keeps bank ids unique and exposes category labels for the wallet selector', () => {
    const ids = SOUTH_AFRICAN_BANKS.map((bank) => bank.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(BANK_CATEGORY_LABELS)).toHaveLength(4);
    expect(SOUTH_AFRICAN_BANK_SOURCE).toContain('South African Reserve Bank');
  });

  it('includes the major South African retail banks', () => {
    const names = SOUTH_AFRICAN_BANKS.map((bank) => bank.name);
    expect(names).toEqual(expect.arrayContaining([
      'ABSA Bank Limited',
      'Capitec Bank Limited',
      'FirstRand Bank Limited',
      'Nedbank Limited',
      'Standard Bank',
      'TymeBank Limited',
    ]));
  });
});
