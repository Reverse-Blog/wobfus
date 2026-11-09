import type { Instruction, VmProgram } from './vm-runtime.js';

const maxBlockInstructions = 12;

export function flattenVmControlFlow(
  code: Instruction[],
  instructions: VmProgram['instructions'],
): Instruction[] {
  const opcode = (name: string): number => {
    const value = instructions[name];
    if (value === undefined) throw new Error(`Missing control-flow opcode: ${name}`);
    return value;
  };
  const jump = opcode('jump');
  const returns = opcode('return');
  const branches = new Set([jump, opcode('jumpFalse'), opcode('jumpTrue'), opcode('jumpNotNull')]);
  const leaders = new Set([0, code.length]);
  code.forEach(([operation, target], index) => {
    if (branches.has(operation)) {
      if (typeof target !== 'number' || !Number.isInteger(target) || target < 0 || target > code.length) {
        throw new Error(`Invalid VM jump target at instruction ${index}.`);
      }
      leaders.add(target);
    }
    if (branches.has(operation) || operation === returns) leaders.add(index + 1);
  });
  const boundaries = [...leaders].sort((a, b) => a - b);
  const blocks: Array<{ start: number; code: Instruction[] }> = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    for (let position = start; position < end; position += maxBlockInstructions) {
      const next = Math.min(position + maxBlockInstructions, end);
      const body = code.slice(position, next).map((instruction): Instruction => [...instruction]);
      const last = body[body.length - 1];
      if (!last) throw new Error('Empty VM control-flow block.');
      // Conditional branches need an explicit edge for their original fallthrough.
      if (last[0] !== jump && last[0] !== returns) body.push([jump, next]);
      blocks.push({ start: position, code: body });
    }
  }
  if (blocks.length === 0) return [];

  // Reproducible permutation keeps output and size comparisons stable.
  let state = code.length;
  for (let index = blocks.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = state % (index + 1);
    [blocks[index], blocks[other]] = [blocks[other]!, blocks[index]!];
  }
  if (blocks.length > 1 && blocks.every((block, index) =>
    index === 0 || blocks[index - 1]!.start < block.start)) {
    blocks.reverse();
  }

  const relocated = new Map<number, number>();
  let length = 1;
  for (const block of blocks) {
    relocated.set(block.start, length);
    length += block.code.length;
  }
  relocated.set(code.length, length);
  const targetAddress = (target: unknown): number => {
    const address = typeof target === 'number' ? relocated.get(target) : undefined;
    if (address === undefined) throw new Error('Missing relocated VM jump target.');
    return address;
  };
  const flattened: Instruction[] = [[jump, targetAddress(0)]];
  for (const block of blocks) {
    for (const instruction of block.code) {
      if (branches.has(instruction[0])) instruction[1] = targetAddress(instruction[1]);
      flattened.push(instruction);
    }
  }
  return flattened;
}
