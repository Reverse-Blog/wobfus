import { parse } from '@babel/parser';
import traverse, { type Binding } from '@babel/traverse';
import generate from '@babel/generator';

// Big5 level-two ideographs at byte pairs F940-F94F.
export const big5Alphabet = '\u7e98\u7e9b\u7e99\u81e0\u81e1\u8646\u8647\u8648\u8979\u897a\u897c\u897b\u89ff\u8b98\u8b99\u8ea5';

export function big5Identifier(index: number): string {
  let name = '';
  do {
    const invisible = index % 2 === 0 ? '\u200c' : '\u200d';
    name = big5Alphabet[index % big5Alphabet.length]! + invisible + name;
    index = Math.floor(index / big5Alphabet.length) - 1;
  } while (index >= 0);
  return name;
}

export function encodeBig5(value: string, key: number): string {
  let encoded = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index) ^ key;
    for (let shift = 12; shift >= 0; shift -= 4) {
      const invisible = (index + shift / 4) % 2 === 0 ? '\u200c' : '\u200d';
      encoded += big5Alphabet[(code >>> shift) & 15]! + invisible;
    }
  }
  return encoded;
}

export function renameBig5Identifiers(source: string): string {
  const ast = parse(source, { sourceType: 'script' });
  const used = new Set<string>();
  const renamed = new Set<Binding>();
  traverse(ast, {
    Identifier(path) {
      used.add(path.node.name);
    },
    StringLiteral(path) {
      delete path.node.extra;
    },
  });
  let index = 0;
  traverse(ast, {
    Scopable(path) {
      for (const binding of Object.values(path.scope.bindings)) {
        if (renamed.has(binding)) continue;
        renamed.add(binding);
        let replacement: string;
        do {
          replacement = big5Identifier(index++);
        } while (used.has(replacement));
        used.add(replacement);
        binding.scope.rename(binding.identifier.name, replacement);
      }
    },
  });
  return generate(ast, {
    compact: true, comments: false, jsescOption: { minimal: true },
  }).code;
}
