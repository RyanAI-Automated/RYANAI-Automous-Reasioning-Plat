import { useState } from 'react';
import { Calculator as CalculatorIcon } from 'lucide-react';
import { evaluateCalculatorExpression, formatCalculatorResult, CalculatorInputError } from '@/utils/calculator';

type KeyAction = 'clear' | 'backspace' | 'digit' | 'decimal' | 'operator' | 'equals';
type CalculatorKey = {
  label: string;
  ariaLabel: string;
  action: KeyAction;
  value?: string;
  emphasis?: 'operator' | 'utility' | 'equals';
  wide?: boolean;
};

const keys: CalculatorKey[] = [
  { label: 'AC', ariaLabel: 'Clear', action: 'clear', emphasis: 'utility' },
  { label: '⌫', ariaLabel: 'Backspace', action: 'backspace', emphasis: 'utility' },
  { label: '÷', ariaLabel: 'Divide', action: 'operator', value: '/', emphasis: 'operator' },
  { label: '×', ariaLabel: 'Multiply', action: 'operator', value: '*', emphasis: 'operator' },
  { label: '7', ariaLabel: 'Digit 7', action: 'digit', value: '7' },
  { label: '8', ariaLabel: 'Digit 8', action: 'digit', value: '8' },
  { label: '9', ariaLabel: 'Digit 9', action: 'digit', value: '9' },
  { label: '−', ariaLabel: 'Subtract', action: 'operator', value: '-', emphasis: 'operator' },
  { label: '4', ariaLabel: 'Digit 4', action: 'digit', value: '4' },
  { label: '5', ariaLabel: 'Digit 5', action: 'digit', value: '5' },
  { label: '6', ariaLabel: 'Digit 6', action: 'digit', value: '6' },
  { label: '+', ariaLabel: 'Add', action: 'operator', value: '+', emphasis: 'operator' },
  { label: '1', ariaLabel: 'Digit 1', action: 'digit', value: '1' },
  { label: '2', ariaLabel: 'Digit 2', action: 'digit', value: '2' },
  { label: '3', ariaLabel: 'Digit 3', action: 'digit', value: '3' },
  { label: '0', ariaLabel: 'Digit 0', action: 'digit', value: '0', wide: true },
  { label: '.', ariaLabel: 'Decimal point', action: 'decimal' },
  { label: '=', ariaLabel: 'Equals', action: 'equals', emphasis: 'equals' },
];

const operatorPattern = /[+*/-]\s*$/;

export default function CalculatorPage() {
  const [expression, setExpression] = useState('');
  const [hasResult, setHasResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const press = (key: CalculatorKey) => {
    setError(null);

    if (key.action === 'clear') {
      setExpression('');
      setHasResult(false);
      return;
    }

    if (key.action === 'backspace') {
      setExpression((current) => current.trimEnd().slice(0, -1).trimEnd());
      setHasResult(false);
      return;
    }

    if (key.action === 'digit') {
      const digit = key.value ?? '';
      setExpression((current) => (hasResult ? digit : current + digit));
      setHasResult(false);
      return;
    }

    if (key.action === 'decimal') {
      setExpression((current) => {
        const base = hasResult ? '' : current;
        const currentOperand = base.split(/[+*/-]/).at(-1) ?? '';
        if (currentOperand.includes('.')) return current;
        return base + (currentOperand.trim() ? '.' : '0.');
      });
      setHasResult(false);
      return;
    }

    if (key.action === 'operator') {
      const operator = key.value ?? '';
      setExpression((current) => {
        const trimmed = current.trimEnd();
        if (!trimmed) return operator === '-' ? '-' : '';
        if (operatorPattern.test(trimmed)) {
          return trimmed.replace(operatorPattern, '').trimEnd() + ' ' + operator + ' ';
        }
        return trimmed + ' ' + operator + ' ';
      });
      setHasResult(false);
      return;
    }

    if (key.action === 'equals') {
      try {
        const result = evaluateCalculatorExpression(expression);
        setExpression(formatCalculatorResult(result));
        setHasResult(true);
      } catch (cause) {
        setError(cause instanceof CalculatorInputError ? cause.message : 'Unable to calculate this expression.');
      }
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10" aria-labelledby="calculator-heading">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
          <CalculatorIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/70">RyanAI · Tools</p>
          <h1 id="calculator-heading" className="text-xl font-semibold text-slate-100 md:text-2xl">JavaScript Calculator</h1>
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-300/15 bg-[#101724] p-4 shadow-xl shadow-black/20 md:p-6">
        <div className="mb-4 rounded-xl border border-white/10 bg-[#090e18] px-4 py-5 text-right">
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Expression</p>
          <output aria-label="Calculator display" aria-live="polite" aria-atomic="true" className="block min-h-10 break-all font-mono text-3xl font-semibold tracking-wide text-cyan-100 md:text-4xl">
            {expression || '0'}
          </output>
          {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
        </div>

        <div role="group" aria-label="Calculator keypad" className="grid grid-cols-4 gap-2">
          {keys.map((key) => (
            <button
              key={key.ariaLabel}
              type="button"
              aria-label={key.ariaLabel}
              data-calculator-key={key.action}
              onClick={() => press(key)}
              className={[
                'min-h-14 rounded-xl border text-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101724] active:scale-[0.98]',
                key.wide ? 'col-span-2' : '',
                key.emphasis === 'operator' ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20' : '',
                key.emphasis === 'utility' ? 'border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10' : '',
                key.emphasis === 'equals' ? 'border-cyan-300/40 bg-cyan-300 text-slate-950 hover:bg-cyan-200' : '',
                !key.emphasis ? 'border-white/10 bg-[#182233] text-slate-100 hover:bg-[#223148]' : '',
              ].join(' ')}
            >
              {key.label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4 text-xs text-slate-500">
          <span>Local simulation · no external services</span>
          <span>Safe arithmetic parser · no eval</span>
        </div>
      </div>
      <p className="mt-4 text-xs leading-6 text-slate-500">
        Supports chained operations, decimal values and standard multiplication/division precedence. Invalid expressions and division by zero are reported without stopping the workspace.
      </p>
    </section>
  );
}
