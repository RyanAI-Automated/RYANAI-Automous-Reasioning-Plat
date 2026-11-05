export class CalculatorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculatorInputError';
  }
}

function tokenize(expression: string): string[] {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new CalculatorInputError('Enter a calculation first.');
  }
  if (expression.length > 256) {
    throw new CalculatorInputError('The calculation is too long.');
  }

  const tokens: string[] = [];
  let index = 0;
  while (index < expression.length) {
    if (/\s/.test(expression[index])) {
      index += 1;
      continue;
    }

    const remaining = expression.slice(index);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(remaining);
    if (number) {
      tokens.push(number[0]);
      index += number[0].length;
    } else if ('+-*/()'.includes(expression[index])) {
      tokens.push(expression[index]);
      index += 1;
    } else {
      throw new CalculatorInputError('Only numbers and +, −, ×, ÷, and parentheses are supported.');
    }

    if (tokens.length > 64) {
      throw new CalculatorInputError('The calculation has too many parts.');
    }
  }

  return tokens;
}

/** Parse arithmetic with normal operator precedence. Never executes source code. */
export function evaluateCalculatorExpression(expression: string): number {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => tokens[position];

  function parsePrimary(): number {
    const token = peek();
    if (token === '(') {
      position += 1;
      const value = parseExpression();
      if (peek() !== ')') throw new CalculatorInputError('A closing parenthesis is missing.');
      position += 1;
      return value;
    }

    if (token === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      throw new CalculatorInputError('The calculation is incomplete or malformed.');
    }

    position += 1;
    const value = Number(token);
    if (!Number.isFinite(value)) throw new CalculatorInputError('The number is outside the supported range.');
    return value;
  }

  function parseUnary(): number {
    if (peek() === '+') {
      position += 1;
      return parseUnary();
    }
    if (peek() === '-') {
      position += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parseTerm(): number {
    let value = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const operator = tokens[position];
      position += 1;
      const right = parseUnary();
      if (operator === '/') {
        if (right === 0) throw new CalculatorInputError('Cannot divide by zero.');
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[position];
      position += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (position !== tokens.length) {
    throw new CalculatorInputError('The calculation contains an unexpected value.');
  }
  if (!Number.isFinite(result)) throw new CalculatorInputError('The result is outside the supported range.');
  return result;
}

/** Keep demo display values readable without exposing binary floating-point noise. */
export function formatCalculatorResult(value: number): string {
  if (!Number.isFinite(value)) throw new CalculatorInputError('The result is outside the supported range.');
  const rounded = Number(value.toPrecision(12));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
