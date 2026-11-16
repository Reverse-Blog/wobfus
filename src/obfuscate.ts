import { compileVm } from './vm-compiler.ts';
import { serializeVm } from './vm-runtime.ts';

export function obfuscate(source: string): string {
  return obfuscateWithMetadata(source).code;
}

export function obfuscateWithMetadata(source: string) {
  const program = compileVm(source);
  return {
    code: serializeVm(program),
    opcodes: [
      ...Object.entries(program.instructions).map(([name, opcode]) => ({
        name, opcode, kind: 'instruction',
      })),
      ...Object.entries(program.globals).map(([opcode, path]) => ({
        name: path.join('.'), opcode: Number(opcode), kind: 'API',
      })),
    ],
  };
}
