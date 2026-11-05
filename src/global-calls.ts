import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

export interface GlobalCall {
  callee: string;
  type: string;
  line: number;
  column: number;
}

export interface GlobalApi {
  name: string;
  type: string;
}

function referenceDescriptor(node: t.Expression): PropertyDescriptor | undefined {
  if (t.isIdentifier(node)) {
    return propertyDescriptor(globalThis, node.name);
  }

  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    if (t.isExpression(node.object)) {
      const object = referenceDescriptor(node.object);
      if (!object || !('value' in object)) {
        return undefined;
      }
      const value: unknown = object.value;
      if (!node.computed && t.isIdentifier(node.property)) {
        return propertyDescriptor(value, node.property.name);
      }
      if (t.isStringLiteral(node.property) || t.isNumericLiteral(node.property)) {
        return propertyDescriptor(value, String(node.property.value));
      }
    }
  }

  return undefined;
}

function propertyDescriptor(value: unknown, key: string): PropertyDescriptor | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  let object: object | null = value;
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) {
      return descriptor;
    }
    object = Object.getPrototypeOf(object);
  }
  return undefined;
}

function descriptorType(descriptor: PropertyDescriptor | undefined): string {
  if (!descriptor) {
    return 'unknown';
  }
  if (!('value' in descriptor)) {
    return 'accessor';
  }
  const value: unknown = descriptor.value;
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'function') {
    if (/^\s*class\b/.test(Function.prototype.toString.call(value))) {
      return 'class';
    }
    if (Object.getOwnPropertyDescriptor(value, 'prototype')) {
      return 'constructor';
    }
    return 'function';
  }
  return typeof value;
}

function referenceType(node: t.Expression): string {
  return descriptorType(referenceDescriptor(node));
}

export function listGlobalApis(root: object = globalThis): GlobalApi[] {
  const names = new Set<string>();
  let object: object | null = root;
  while (object) {
    for (const name of Object.getOwnPropertyNames(object)) {
      names.add(name);
    }
    object = Object.getPrototypeOf(object);
  }

  return [...names]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((name) => ({
      name,
      type: descriptorType(propertyDescriptor(root, name)),
    }));
}

export function findGlobalCalls(source: string): GlobalCall[] {
  const ast = parse(source, { sourceType: 'unambiguous' });
  const calls: GlobalCall[] = [];

  traverse(ast, {
    ReferencedIdentifier(path) {
      if (
        !t.isIdentifier(path.node) ||
        !(path.node.name in globalThis) ||
        path.scope.getBinding(path.node.name)
      ) {
        return;
      }

      let reference: t.Expression = path.node;
      let parent: NodePath | null = path.parentPath;
      while (
        parent &&
        (t.isMemberExpression(parent.node) ||
          t.isOptionalMemberExpression(parent.node)) &&
        parent.node.object === reference
      ) {
        reference = parent.node;
        parent = parent.parentPath;
      }

      const location = reference.loc?.start;
      if (!location || reference.start == null || reference.end == null) {
        throw new Error('Could not determine the source location for a global reference.');
      }

      calls.push({
        callee: source.slice(reference.start, reference.end),
        type: referenceType(reference),
        line: location.line,
        column: location.column + 1,
      });
    },
  });

  return calls;
}
