export type Instruction = [number, ...unknown[]];
export interface VmFunction {
  parameters: string[];
  code: Instruction[];
  arrow: boolean;
  name: string | null;
}
export interface VmProgram {
  instructions: Record<string, number>;
  globals: Record<number, string[]>;
  functions: VmFunction[];
}

type PackedFunction = [string[], Instruction[], boolean, string | null];
type RuntimeProgram = [VmProgram['instructions'], Array<[number, string[]]>, PackedFunction[]];

export function serializeVm(program: VmProgram): string {
  const payload: RuntimeProgram = [
    program.instructions,
    Object.entries(program.globals).map(([opcode, path]) => [Number(opcode), path]),
    program.functions.map(({ parameters, code, arrow, name }) => [parameters, code, arrow, name]),
  ];
  const ast = parse(`(()=>{"use strict";return (${executeVm.toString()})(${JSON.stringify(payload)})})()`);
  traverse(ast, {
    ClassProperty(path) {
      if (path.node.value == null) path.remove();
    },
  });
  return generate(ast, {
    compact: true, comments: false, jsescOption: { minimal: true },
  }).code;
}

export function executeVm(program: RuntimeProgram): unknown {
  const globals = new Map(program[1]);
  const functions = program[2];
  interface Slot {
    value: unknown;
    initialized: boolean;
    constant: boolean;
  }
  interface Environment {
    parent: Environment | undefined;
    slots: Map<string, Slot>;
  }
  class Reference {
    readonly read: () => unknown;
    readonly write: (value: unknown) => void;
    readonly receiver: unknown;
    constructor(
      read: () => unknown,
      write: (value: unknown) => void,
      receiver: unknown = undefined,
    ) {
      this.read = read;
      this.write = write;
      this.receiver = receiver;
    }
  }
  class CallTarget {
    constructor(
      target: unknown,
      receiver: unknown,
      apiOpcode: number | undefined = undefined,
    ) {
      this.target = target;
      this.receiver = receiver;
      this.apiOpcode = apiOpcode;
    }
    readonly target: unknown;
    readonly receiver: unknown;
    readonly apiOpcode: number | undefined;
  }

  const operations: Record<string, (...args: never[]) => unknown> = {
    '+': (a: number, b: number) => a + b,
    '-': (a: number, b: number) => a - b,
    '*': (a: number, b: number) => a * b,
    '/': (a: number, b: number) => a / b,
    '%': (a: number, b: number) => a % b,
    '**': (a: number, b: number) => a ** b,
    '<': (a: number, b: number) => a < b,
    '<=': (a: number, b: number) => a <= b,
    '>': (a: number, b: number) => a > b,
    '>=': (a: number, b: number) => a >= b,
    '===': (a: unknown, b: unknown) => a === b,
    '!==': (a: unknown, b: unknown) => a !== b,
    '==': (a: unknown, b: unknown) => a == b,
    '!=': (a: unknown, b: unknown) => a != b,
    '&': (a: number, b: number) => a & b,
    '|': (a: number, b: number) => a | b,
    '^': (a: number, b: number) => a ^ b,
    '<<': (a: number, b: number) => a << b,
    '>>': (a: number, b: number) => a >> b,
    '>>>': (a: number, b: number) => a >>> b,
    in: (a: PropertyKey, b: object) => a in b,
    instanceof: (a: object, b: Function) => a instanceof b,
    '!': (a: unknown) => !a,
    '~': (a: number) => ~a,
    'u+': (a: number) => +a,
    'u-': (a: number) => -a,
    typeof: (a: unknown) => typeof a,
    void: (_a: unknown) => undefined,
    increment: (a: number) => ++a,
    decrement: (a: number) => --a,
    numeric: (a: number) => a++,
  };
  const operation = (name: string, values: unknown[]) => {
    const fn = operations[name];
    if (!fn) throw new Error(`Unknown VM operator: ${name}`);
    // Reflect.apply preserves JavaScript coercion for dynamically typed operands.
    return Reflect.apply(fn, undefined, values);
  };
  const reference = (value: unknown): Reference => {
    if (!(value instanceof Reference)) throw new Error('Invalid VM reference.');
    return value;
  };
  const local = (environment: Environment, name: string): Reference => {
    let current: Environment | undefined = environment;
    while (current && !current.slots.has(name)) current = current.parent;
    const slot = current?.slots.get(name);
    if (!slot) throw new ReferenceError(`${name} is not defined`);
    return new Reference(
      () => {
        if (!slot.initialized) throw new ReferenceError(`Cannot access ${name} before initialization`);
        return slot.value;
      },
      (value) => {
        if (!slot.initialized) throw new ReferenceError(`Cannot access ${name} before initialization`);
        if (slot.constant) throw new TypeError(`Assignment to constant variable ${name}`);
        slot.value = value;
      },
    );
  };
  const globalReference = (name: string): Reference => new Reference(
    () => {
      if (!(name in globalThis)) throw new ReferenceError(`${name} is not defined`);
      return Reflect.get(globalThis, name);
    },
    (value) => {
      if (!(name in globalThis)) throw new ReferenceError(`${name} is not defined`);
      if (!Reflect.set(globalThis, name, value)) throw new TypeError(`Cannot assign global ${name}`);
    },
  );
  const member = (object: unknown, key: unknown): Reference => {
    if (object == null) throw new TypeError('Cannot access a property of null or undefined');
    const property = typeof key === 'symbol' ? key : String(key);
    return new Reference(
      () => Reflect.get(Object(object), property, object),
      (value) => {
        if (
          (typeof object !== 'object' && typeof object !== 'function') ||
          !Reflect.set(object, property, value)
        ) throw new TypeError(`Cannot assign property ${String(property)}`);
      },
      object,
    );
  };
  const apis = new Map([...globals].map(([opcode, path]) => [opcode, () => {
    const name = path[0];
    if (!name) throw new Error('Invalid API path.');
    let target = globalReference(name);
    for (const key of path.slice(1)) target = member(target.read(), key);
    return target;
  }]));
  const invoke = (
    stack: unknown[],
    count: number,
    construct: boolean,
    apiOpcode: number | undefined = undefined,
  ): unknown => {
    const values = stack.splice(stack.length - count, count);
    const target = stack.pop();
    if (!(target instanceof CallTarget)) throw new Error('Invalid VM call target.');
    if (target.apiOpcode !== apiOpcode) throw new Error('Mismatched VM API call opcode.');
    const callable = target.target;
    if (typeof callable !== 'function') throw new TypeError('VM call target is not a function');
    return construct
      ? Reflect.construct(callable, values)
      : Reflect.apply(callable, target.receiver, values);
  };
  const run = (
    index: number,
    parent: Environment | undefined,
    args: unknown[],
    thisValue: unknown,
  ): unknown => {
    const fn = functions[index];
    if (!fn) throw new Error(`Unknown VM function: ${index}`);
    let environment: Environment = { parent, slots: new Map() };
    const stack: unknown[] = [];
    fn[0].forEach((name, i) => environment.slots.set(name, {
      value: args[i], initialized: true, constant: false,
    }));
    if (!fn[2]) {
      environment.slots.set('arguments', { value: args, initialized: true, constant: false });
    }

    let pc = 0;
    while (pc < fn[1].length) {
      const instruction = fn[1][pc++];
      if (!instruction) throw new Error('Missing VM instruction.');
      const [opcode, operand, extra] = instruction;
      const op = program[0];
      if (apis.has(opcode)) {
        stack.push(invoke(stack, Number(operand), Boolean(extra), opcode));
        continue;
      }
      switch (opcode) {
        case op.constant: stack.push(operand); break;
        case op.number: stack.push(Number(operand)); break;
        case op.bigint: stack.push(BigInt(String(operand))); break;
        case op.undefined: stack.push(undefined); break;
        case op.this: stack.push(thisValue); break;
        case op.apiReference: {
          const resolve = apis.get(Number(operand));
          if (!resolve) throw new Error('Invalid API reference opcode.');
          stack.push(resolve());
          break;
        }
        case op.typeofGlobal: {
          const name = globals.get(Number(operand))?.[0];
          if (!name) throw new Error('Invalid typeof global opcode.');
          stack.push(typeof Reflect.get(globalThis, name));
          break;
        }
        case op.local: stack.push(local(environment, String(operand))); break;
        case op.read: stack.push(reference(stack.pop()).read()); break;
        case op.member: {
          const key = stack.pop();
          stack.push(member(stack.pop(), key));
          break;
        }
        case op.write: {
          const value = stack.pop();
          reference(stack.pop()).write(value);
          stack.push(value);
          break;
        }
        case op.update: {
          const target = reference(stack.pop());
          const old = operation('numeric', [target.read()]);
          const value = operation(String(operand), [old]);
          target.write(value);
          stack.push(extra ? value : old);
          break;
        }
        case op.prepareCall: {
          const value = stack.pop();
          const apiOpcode = operand === undefined ? undefined : Number(operand);
          stack.push(value instanceof Reference
            ? new CallTarget(value.read(), value.receiver, apiOpcode)
            : new CallTarget(value, undefined, apiOpcode));
          break;
        }
        case op.call:
        case op.construct: {
          stack.push(invoke(stack, Number(operand), opcode === op.construct));
          break;
        }
        case op.array: stack.push(stack.splice(stack.length - Number(operand), Number(operand))); break;
        case op.object: stack.push({}); break;
        case op.property: {
          const value = stack.pop();
          const key = stack.pop();
          const object = stack[stack.length - 1];
          if (typeof object !== 'object' || object === null) throw new Error('Invalid VM object.');
          Object.defineProperty(object, typeof key === 'symbol' ? key : String(key), {
            value, writable: true, enumerable: true, configurable: true,
          });
          break;
        }
        case op.closure: {
          let closure = environment;
          const functionIndex = Number(operand);
          const metadata = functions[functionIndex];
          if (!metadata) throw new Error('Invalid closure function.');
          const callable: (...values: unknown[]) => unknown = metadata[2]
            ? (...values: unknown[]) => run(functionIndex, closure, values, thisValue)
            : function (this: unknown, ...values: unknown[]): unknown {
              return run(functionIndex, closure, values, this);
            };
          if (metadata[3]) {
            closure = {
              parent: closure,
              slots: new Map([[metadata[3], { value: callable, initialized: true, constant: true }]]),
            };
          }
          Object.defineProperty(callable, 'length', { value: metadata[0].length });
          stack.push(callable);
          break;
        }
        case op.pop: stack.pop(); break;
        case op.duplicate: stack.push(stack[stack.length - 1]); break;
        case op.binary: {
          const right = stack.pop();
          stack.push(operation(String(operand), [stack.pop(), right]));
          break;
        }
        case op.unary: stack.push(operation(String(operand), [stack.pop()])); break;
        case op.jump: pc = Number(operand); break;
        case op.jumpFalse: if (!stack.pop()) pc = Number(operand); break;
        case op.jumpTrue: if (stack.pop()) pc = Number(operand); break;
        case op.jumpNotNull: if (stack.pop() != null) pc = Number(operand); break;
        case op.enter: {
          environment = { parent: environment, slots: new Map() };
          if (!Array.isArray(operand)) throw new Error('Invalid scope metadata.');
          for (const binding of operand) {
            const [name, kind] = binding;
            environment.slots.set(name, {
              value: undefined, initialized: kind === 'var', constant: kind === 'const',
            });
          }
          break;
        }
        case op.cloneScope: {
          environment = {
            parent: environment.parent,
            slots: new Map([...environment.slots].map(([name, slot]) => [name, { ...slot }])),
          };
          break;
        }
        case op.leave: {
          if (!environment.parent) throw new Error('Cannot leave root VM scope.');
          environment = environment.parent;
          break;
        }
        case op.initialize: {
          const slot = environment.slots.get(String(operand));
          if (!slot) throw new Error(`Missing VM binding: ${String(operand)}`);
          slot.value = stack.pop();
          slot.initialized = true;
          break;
        }
        case op.return: return stack.pop();
        default: throw new Error(`Unknown VM opcode: ${opcode}`);
      }
    }
    return undefined;
  };
  return run(0, undefined, [], globalThis);
}
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
