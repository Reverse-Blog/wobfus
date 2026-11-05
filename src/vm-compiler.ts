import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { Instruction, VmFunction, VmProgram } from './vm-runtime.js';

const instructionNames = [
  'constant', 'number', 'bigint', 'undefined', 'this', 'local', 'read', 'member',
  'write', 'update', 'call', 'construct', 'array', 'object', 'property', 'closure',
  'pop', 'duplicate', 'binary', 'unary', 'jump', 'jumpFalse', 'jumpTrue',
  'jumpNotNull', 'enter', 'cloneScope', 'leave', 'initialize', 'return', 'prepareCall', 'typeofGlobal',
] as const;
type Binding = [string, string];

export function compileVm(source: string): VmProgram {
  const ast = parse(source, { sourceType: 'script' });
  const used = new Set<number>();
  const randomOpcode = () => {
    let opcode: number;
    do {
      opcode = 0x1000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 0xffff000);
    } while (used.has(opcode));
    used.add(opcode);
    return opcode;
  };
  const instructions = Object.fromEntries(instructionNames.map((name) => [name, randomOpcode()]));
  const globals: Record<number, string[]> = {};
  const globalCodes = new Map<string, number>();
  const localNames = new Map<string, string>();
  const localName = (name: string): string => {
    if (name === 'arguments') return name;
    let token = localNames.get(name);
    if (token === undefined) {
      token = `$${localNames.size.toString(36)}`;
      localNames.set(name, token);
    }
    return token;
  };
  const localIdentifiers = new WeakSet<t.Identifier>();
  traverse(ast, {
    Identifier(path) {
      if (path.scope.getBinding(path.node.name) || path.node.name === 'arguments') {
        localIdentifiers.add(path.node);
      }
    },
  });
  const functions: VmFunction[] = [];
  const fail = (node: t.Node, message = `Unsupported VM syntax: ${node.type}`): never => {
    throw new SyntaxError(`${message}${node.loc ? ` at ${node.loc.start.line}:${node.loc.start.column + 1}` : ''}`);
  };
  const globalCode = (path: string[]) => {
    const key = JSON.stringify(path);
    let code = globalCodes.get(key);
    if (code === undefined) {
      if (path[0] === 'eval' || path[0] === 'Function') {
        throw new SyntaxError('Dynamic code execution is not supported by the VM.');
      }
      code = randomOpcode();
      globalCodes.set(key, code);
      globals[code] = path;
    }
    return code;
  };

  const compileFunction = (
    body: t.Statement[],
    parameters: t.Function['params'],
    arrow: boolean,
    selfName?: string,
  ): number => {
    const index = functions.length;
    const code: Instruction[] = [];
    const names = parameters.map((parameter) => {
      if (!t.isIdentifier(parameter)) return fail(parameter, 'Only plain function parameters are supported');
      return localName(parameter.name);
    });
    if (new Set(names).size !== names.length) {
      throw new SyntaxError('Duplicate VM function parameters are not supported.');
    }
    functions.push({ parameters: names, code, arrow, name: selfName === undefined ? null : localName(selfName) });
    const emit = (name: string, ...args: unknown[]): number => {
      const opcode = instructions[name];
      if (opcode === undefined) throw new Error(`Missing compiler opcode: ${name}`);
      code.push([opcode, ...args]);
      return code.length - 1;
    };
    const patch = (position: number, target = code.length) => {
      const instruction = code[position];
      if (!instruction) throw new Error('Missing compiler jump.');
      instruction[1] = target;
    };
    const globalPath = (node: t.Node): string[] | undefined => {
      if (t.isIdentifier(node) && !localIdentifiers.has(node)) return [node.name];
      if (t.isMemberExpression(node)) {
        const parent = globalPath(node.object);
        if (!parent) return undefined;
        if (!node.computed && t.isIdentifier(node.property)) return [...parent, node.property.name];
        if (node.computed && (t.isStringLiteral(node.property) || t.isNumericLiteral(node.property))) {
          return [...parent, String(node.property.value)];
        }
      }
      return undefined;
    };
    const emitReference = (node: t.Node): void => {
      const path = globalPath(node);
      if (path) {
        code.push([globalCode(path)]);
        return;
      }
      if (t.isIdentifier(node)) {
        emit('local', localName(node.name));
      } else if (t.isMemberExpression(node)) {
        if (!t.isExpression(node.object)) return fail(node);
        expression(node.object);
        if (node.computed) expression(node.property);
        else if (t.isIdentifier(node.property)) emit('constant', node.property.name);
        else return fail(node.property);
        emit('member');
      } else {
        fail(node, 'Unsupported assignment or call reference');
      }
    };
    const expression = (node: t.Node): void => {
      if (t.isIdentifier(node) || t.isMemberExpression(node)) {
        emitReference(node);
        emit('read');
      } else if (t.isNumericLiteral(node)) emit('number', String(node.value));
      else if (t.isBigIntLiteral(node)) emit('bigint', String(node.value));
      else if (t.isStringLiteral(node) || t.isBooleanLiteral(node)) emit('constant', node.value);
      else if (t.isNullLiteral(node)) emit('constant', null);
      else if (t.isThisExpression(node)) emit('this');
      else if (t.isTemplateLiteral(node)) {
        const first = node.quasis[0]?.value.cooked;
        if (first === undefined || first === null) return fail(node, 'Invalid template literal escape');
        emit('constant', first);
        node.expressions.forEach((part, index) => {
          const following = node.quasis[index + 1]?.value.cooked;
          if (following === undefined || following === null) {
            return fail(node, 'Invalid template literal escape');
          }
          expression(part);
          emit('binary', '+');
          emit('constant', following);
          emit('binary', '+');
        });
      } else if (t.isBinaryExpression(node)) {
        expression(node.left);
        expression(node.right);
        emit('binary', node.operator);
      } else if (t.isUnaryExpression(node) && node.operator !== 'delete' && node.operator !== 'throw') {
        if (node.operator === 'typeof' && t.isIdentifier(node.argument) && !localIdentifiers.has(node.argument)) {
          emit('typeofGlobal', globalCode([node.argument.name]));
        } else {
          expression(node.argument);
          emit('unary', node.operator === '+' || node.operator === '-' ? `u${node.operator}` : node.operator);
        }
      } else if (t.isLogicalExpression(node)) {
        expression(node.left);
        emit('duplicate');
        const jump = emit(node.operator === '&&' ? 'jumpFalse' : node.operator === '||' ? 'jumpTrue' : 'jumpNotNull', 0);
        emit('pop');
        expression(node.right);
        patch(jump);
      } else if (t.isConditionalExpression(node)) {
        expression(node.test);
        const otherwise = emit('jumpFalse', 0);
        expression(node.consequent);
        const end = emit('jump', 0);
        patch(otherwise);
        expression(node.alternate);
        patch(end);
      } else if (t.isSequenceExpression(node)) {
        node.expressions.forEach((item, i) => {
          expression(item);
          if (i < node.expressions.length - 1) emit('pop');
        });
      } else if (t.isAssignmentExpression(node)) {
        if (['&&=', '||=', '??='].includes(node.operator)) return fail(node);
        emitReference(node.left);
        if (node.operator !== '=') {
          emit('duplicate');
          emit('read');
        }
        expression(node.right);
        if (node.operator !== '=') emit('binary', node.operator.slice(0, -1));
        emit('write');
      } else if (t.isUpdateExpression(node)) {
        emitReference(node.argument);
        emit('update', node.operator === '++' ? 'increment' : 'decrement', node.prefix);
      } else if (t.isCallExpression(node) || t.isNewExpression(node)) {
        if (t.isIdentifier(node.callee) || t.isMemberExpression(node.callee)) emitReference(node.callee);
        else expression(node.callee);
        emit('prepareCall');
        for (const argument of node.arguments) {
          if (!t.isExpression(argument)) return fail(argument);
          expression(argument);
        }
        emit(t.isNewExpression(node) ? 'construct' : 'call', node.arguments.length);
      } else if (t.isArrayExpression(node)) {
        for (const element of node.elements) {
          if (!element || t.isSpreadElement(element)) return fail(node, 'Sparse arrays and spread are not supported');
          expression(element);
        }
        emit('array', node.elements.length);
      } else if (t.isObjectExpression(node)) {
        emit('object');
        for (const property of node.properties) {
          if (!t.isObjectProperty(property) || !t.isExpression(property.value)) return fail(property);
          if (property.computed) expression(property.key);
          else if (t.isIdentifier(property.key)) emit('constant', property.key.name);
          else if (t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)) emit('constant', property.key.value);
          else return fail(property.key);
          if (!property.computed && (
            t.isIdentifier(property.key, { name: '__proto__' }) ||
            t.isStringLiteral(property.key, { value: '__proto__' })
          )) {
            return fail(property, '__proto__ object literal syntax is not supported');
          }
          expression(property.value);
          emit('property');
        }
      } else if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
        if (node.async || node.generator) return fail(node);
        const statements = t.isBlockStatement(node.body)
          ? node.body.body
          : [t.returnStatement(node.body)];
        emit('closure', compileFunction(statements, node.params, t.isArrowFunctionExpression(node), t.isFunctionExpression(node) ? node.id?.name : undefined));
      } else {
        fail(node);
      }
    };
    const varNames = new Set<string>();
    const collectVars = (node: t.Node): void => {
      if (t.isFunction(node)) return;
      if (t.isVariableDeclaration(node, { kind: 'var' })) {
        for (const declaration of node.declarations) {
          if (!t.isIdentifier(declaration.id)) return fail(declaration.id);
          varNames.add(localName(declaration.id.name));
        }
      }
      for (const key of t.VISITOR_KEYS[node.type] ?? []) {
        const value: unknown = Reflect.get(node, key);
        if (Array.isArray(value)) {
          for (const child of value) if (t.isNode(child)) collectVars(child);
        } else if (t.isNode(value)) collectVars(value);
      }
    };
    body.forEach(collectVars);
    // Var bindings share the parameter environment, not the lexical body scope.
    const vars = [...varNames].filter((name) => !names.includes(name) && name !== 'arguments');
    emit('enter', vars.map((name): Binding => [name, 'var']));
    let depth = 1;
    interface Loop {
      depth: number;
      breaks: number[];
      continues: number[];
    }
    const loops: Loop[] = [];
    const block = (statements: t.Statement[]) => {
      const bindings: Binding[] = [];
      for (const statement of statements) {
        if (t.isVariableDeclaration(statement) && statement.kind !== 'var') {
          for (const declaration of statement.declarations) {
            if (!t.isIdentifier(declaration.id)) return fail(declaration.id);
            bindings.push([localName(declaration.id.name), statement.kind]);
          }
        } else if (t.isFunctionDeclaration(statement) && statement.id) {
          bindings.push([localName(statement.id.name), 'let']);
        }
      }
      emit('enter', bindings);
      depth++;
      for (const declaration of statements) {
        if (t.isFunctionDeclaration(declaration)) {
          if (!declaration.id || declaration.async || declaration.generator) return fail(declaration);
          emit('closure', compileFunction(declaration.body.body, declaration.params, false));
          emit('initialize', localName(declaration.id.name));
        }
      }
      statements.forEach(statement);
      emit('leave');
      depth--;
    };
    const statement = (node: t.Statement): void => {
      if (t.isExpressionStatement(node)) {
        expression(node.expression);
        emit('pop');
      } else if (t.isBlockStatement(node)) block(node.body);
      else if (t.isVariableDeclaration(node)) {
        if (!['var', 'let', 'const'].includes(node.kind)) return fail(node);
        for (const declaration of node.declarations) {
          if (!t.isIdentifier(declaration.id)) return fail(declaration.id);
          if (node.kind === 'var') {
            if (declaration.init) {
              emit('local', localName(declaration.id.name));
              expression(declaration.init);
              emit('write');
              emit('pop');
            }
          } else {
            if (declaration.init) expression(declaration.init);
            else emit('undefined');
            emit('initialize', localName(declaration.id.name));
          }
        }
      } else if (t.isReturnStatement(node)) {
        if (node.argument) expression(node.argument);
        else emit('undefined');
        emit('return');
      } else if (t.isIfStatement(node)) {
        expression(node.test);
        const otherwise = emit('jumpFalse', 0);
        statement(node.consequent);
        const end = emit('jump', 0);
        patch(otherwise);
        if (node.alternate) statement(node.alternate);
        patch(end);
      } else if (t.isWhileStatement(node) || t.isForStatement(node)) {
        const lexical = t.isForStatement(node) && t.isVariableDeclaration(node.init) && node.init.kind !== 'var'
          ? node.init : undefined;
        if (lexical) {
          emit('enter', lexical.declarations.map((declaration): Binding => {
            if (!t.isIdentifier(declaration.id)) return fail(declaration.id);
            return [localName(declaration.id.name), lexical.kind];
          }));
          depth++;
        }
        if (t.isForStatement(node) && node.init) {
          if (t.isVariableDeclaration(node.init)) statement(node.init);
          else { expression(node.init); emit('pop'); }
        }
        if (lexical) emit('cloneScope');
        const start = code.length;
        let end: number | undefined;
        if (node.test) { expression(node.test); end = emit('jumpFalse', 0); }
        const loop: Loop = { depth, breaks: [], continues: [] };
        loops.push(loop);
        statement(node.body);
        const update = code.length;
        if (lexical) emit('cloneScope');
        if (t.isForStatement(node) && node.update) { expression(node.update); emit('pop'); }
        emit('jump', start);
        if (end !== undefined) patch(end);
        loop.breaks.forEach((jump) => patch(jump));
        loop.continues.forEach((jump) => patch(jump, update));
        loops.pop();
        if (lexical) { emit('leave'); depth--; }
      } else if (t.isBreakStatement(node) || t.isContinueStatement(node)) {
        const loop = loops[loops.length - 1];
        if (!loop || node.label) return fail(node);
        for (let i = depth; i > loop.depth; i--) emit('leave');
        (t.isBreakStatement(node) ? loop.breaks : loop.continues).push(emit('jump', 0));
      } else if (!t.isFunctionDeclaration(node) && !t.isEmptyStatement(node)) {
        fail(node);
      }
    };
    block(body);
    emit('undefined');
    emit('return');
    return index;
  };
  compileFunction(ast.program.body, [], false);
  return { instructions, globals, functions };
}
