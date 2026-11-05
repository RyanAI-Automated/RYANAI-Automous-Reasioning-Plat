import { describe, expect, it } from 'vitest';
import { evaluateCalculatorExpression, formatCalculatorResult } from './calculator';

describe('safe calculator arithmetic', () => {
  it('handles the four basic operations', () => {
    expect(evaluateCalculatorExpression('8 + 2')).toBe(10);
    expect(evaluateCalculatorExpression('8 - 2')).toBe(6);
    expect(evaluateCalculatorExpression('8 * 2')).toBe(16);
    expect(evaluateCalculatorExpression('8 / 2')).toBe(4);
  });

  it('handles decimals without displaying binary floating-point noise', () => {
    expect(evaluateCalculatorExpression('0.1 + 0.2')).toBeCloseTo(0.3, 12);
    expect(formatCalculatorResult(evaluateCalculatorExpression('0.1 + 0.2'))).toBe('0.3');
    expect(evaluateCalculatorExpression('.5 * 2.')).toBe(1);
  });

  it('supports chained expressions and standard operator precedence', () => {
    expect(evaluateCalculatorExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateCalculatorExpression('12 / 3 + 2 * 5')).toBe(14);
    expect(evaluateCalculatorExpression('(2 + 3) * 4')).toBe(20);
  });

  it('supports unary positive and negative values', () => {
    expect(evaluateCalculatorExpression('-4 + +2')).toBe(-2);
  });

  it('rejects division by zero', () => {
    expect(() => evaluateCalculatorExpression('5 / 0')).toThrow('Cannot divide by zero');
  });

  it('rejects empty, incomplete and malformed expressions', () => {
    for (const expression of ['', '   ', '2 +', '2 ** 3', '(2 + 3', '2 + 3)', '1.2.3']) {
      expect(() => evaluateCalculatorExpression(expression)).toThrow();
    }
  });

  it('rejects executable input and oversized expressions', () => {
    expect(() => evaluateCalculatorExpression('globalThis.process.exit()')).toThrow();
    expect(() => evaluateCalculatorExpression('1+'.repeat(130) + '1')).toThrow('too long');
  });

  it('normalizes negative zero for display', () => {
    expect(formatCalculatorResult(-0)).toBe('0');
  });
});
