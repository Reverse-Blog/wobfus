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
type PackedProgram = [number[], Array<[number, string[]]>, PackedFunction[]];
type RuntimeProgram = [VmProgram['instructions'], PackedProgram[1], PackedFunction[]];

export function serializeVm(program: VmProgram): string {
  const payload: PackedProgram = [
    Object.values(program.instructions),
    Object.entries(program.globals).map(([opcode, path]) => [Number(opcode), path]),
    program.functions.map(({ parameters, code, arrow, name }) => [parameters, code, arrow, name]),
  ];
  const ast = parse(`(()=>{"use strict";return (${executeVm.toString()})((${decodeVmPayload.toString()})(null,null,null))})()`);
  let dispatchBindingFound = false;
  const instructionNames = Object.keys(program.instructions);
  traverse(ast, {
    ClassProperty(path) {
      if (path.node.value == null) path.remove();
    },
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id) &&
        t.isMemberExpression(path.node.init) &&
        path.node.init.computed &&
        t.isNumericLiteral(path.node.init.property, { value: 0 })
      ) {
        const binding = path.scope.getBinding(path.node.id.name);
        if (!binding) throw new Error('Missing runtime dispatch binding.');
        for (const reference of binding.referencePaths) {
          const lookup = reference.parentPath;
          if (
            !lookup?.isMemberExpression() ||
            lookup.node.object !== reference.node ||
            lookup.node.computed ||
            !t.isIdentifier(lookup.node.property)
          ) throw new Error('Unsupported runtime opcode lookup.');
          const index = instructionNames.indexOf(lookup.node.property.name);
          const opcode = Object.values(program.instructions)[index];
          if (opcode === undefined) throw new Error('Missing runtime instruction opcode.');
          lookup.replaceWith(t.numericLiteral(opcode));
        }
        dispatchBindingFound = true;
        path.remove();
      }
    },
  });
  if (!dispatchBindingFound) throw new Error('Runtime instruction dispatch was not found.');
  const key = crypto.getRandomValues(new Uint32Array(1))[0]! & 0xffff;
  let scope: Scope | undefined;
  traverse(ast, {
    Program(path) {
      scope = path.scope;
      path.stop();
    },
  });
  if (!scope) throw new Error('Missing generated runtime scope.');
  const decoder = scope.generateUidIdentifier('decode');
  const alphabet = scope.generateUidIdentifier('alphabet');
  const stringKey = scope.generateUidIdentifier('key');
  const decodedString = (value: string) => t.callExpression(t.cloneNode(decoder), [
    t.stringLiteral(encodeBig5(value, key)), t.cloneNode(alphabet), t.cloneNode(stringKey),
  ]);
  traverse(ast, {
    MemberExpression: {
      exit(path) {
        if (!path.node.computed && t.isIdentifier(path.node.property)) {
          path.replaceWith(t.memberExpression(
            path.node.object, decodedString(path.node.property.name), true,
          ));
          path.skip();
        }
      },
    },
    StringLiteral(path) {
      if (path.parentPath.isObjectProperty() && path.key === 'key') {
        path.parentPath.node.computed = true;
      }
      path.replaceWith(decodedString(path.node.value));
      path.skip();
    },
    TemplateLiteral: {
      exit(path) {
        const expressions: t.Expression[] = [];
        path.node.quasis.forEach((quasi, index) => {
          if (quasi.value.cooked == null) throw new Error('Invalid runtime template literal.');
          expressions.push(decodedString(quasi.value.cooked));
          const expression = path.node.expressions[index];
          if (expression) {
            t.assertExpression(expression);
            expressions.push(expression);
          }
        });
        path.replaceWith(t.templateLiteral(
          Array.from({ length: expressions.length + 1 }, (_, index) =>
            t.templateElement({ raw: '', cooked: '' }, index === expressions.length)),
          expressions,
        ));
        path.skip();
      },
    },
  });
  const statement = ast.program.body[0];
  t.assertExpressionStatement(statement);
  t.assertCallExpression(statement.expression);
  t.assertArrowFunctionExpression(statement.expression.callee);
  t.assertBlockStatement(statement.expression.callee.body);
  const returnStatement = statement.expression.callee.body.body[0];
  t.assertReturnStatement(returnStatement);
  t.assertCallExpression(returnStatement.argument);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const payloadCall = returnStatement.argument.arguments[0];
  t.assertCallExpression(payloadCall);
  payloadCall.arguments = [
    t.stringLiteral(encodeVmPayload(payload, seed)),
    t.cloneNode(alphabet),
    t.numericLiteral(seed),
  ];
  statement.expression.callee.body.body.unshift(
    t.variableDeclaration('const', [
      t.variableDeclarator(decoder, parseExpression(`(${decodeBig5.toString()})`)),
      t.variableDeclarator(alphabet, t.stringLiteral(
        Array.from(big5Alphabet, (_, index) => big5Identifier(index)).join(''),
      )),
      t.variableDeclarator(stringKey, t.numericLiteral(key)),
    ]),
  );
  return renameBig5Identifiers(generate(ast, {
    compact: true, comments: false, jsescOption: { minimal: true },
  }).code);
}

function decodeBig5(value: string, alphabet: string, key: number): string {
  let decoded = String();
  for (let index = 0; index < value.length; index += 8) {
    let code = 0;
    for (let offset = 0; offset < 4; offset++) {
      code = (code << 4) | (alphabet.indexOf(value[index + offset * 2]!) / 2);
    }
    decoded += String.fromCharCode(code ^ key);
  }
  return decoded;
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
    ) {
      this.target = target;
      this.receiver = receiver;
    }
    readonly target: unknown;
    readonly receiver: unknown;
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
      if (globals.has(opcode)) {
        const path = globals.get(opcode);
        const name = path?.[0];
        if (!path || !name) throw new Error('Invalid global opcode.');
        let target = globalReference(name);
        for (const key of path.slice(1)) target = member(target.read(), key);
        stack.push(target);
        continue;
      }
      switch (opcode) {
        case op.constant: stack.push(operand); break;
        case op.number: stack.push(Number(operand)); break;
        case op.bigint: stack.push(BigInt(String(operand))); break;
        case op.undefined: stack.push(undefined); break;
        case op.this: stack.push(thisValue); break;
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
          stack.push(value instanceof Reference
            ? new CallTarget(value.read(), value.receiver)
            : new CallTarget(value, undefined));
          break;
        }
        case op.call:
        case op.construct: {
          const values = stack.splice(stack.length - Number(operand), Number(operand));
          const target = stack.pop();
          if (!(target instanceof CallTarget)) throw new Error('Invalid VM call target.');
          const callable = target.target;
          if (typeof callable !== 'function') throw new TypeError('VM call target is not a function');
          stack.push(opcode === op.construct
            ? Reflect.construct(callable, values)
            : Reflect.apply(callable, target.receiver, values));
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
import { parse, parseExpression } from '@babel/parser';
import traverse, { type Scope } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { big5Alphabet, big5Identifier, encodeBig5, renameBig5Identifiers } from './big5.ts';
import { decodeVmPayload, encodeVmPayload } from './vm-payload.ts';
