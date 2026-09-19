export type CellValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Grid = readonly CellValue[];

export const GRID_SIZE = 9;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export function parseGrid(serialized: string): CellValue[] {
  const compact = serialized.replace(/\s+/g, "");
  if (compact.length !== CELL_COUNT) {
    throw new Error(`Expected ${CELL_COUNT} cells, received ${compact.length}`);
  }

  return [...compact].map((char, index) => {
    if (char === "." || char === "0") return 0;
    const value = Number(char);
    if (!Number.isInteger(value) || value < 1 || value > 9) {
      throw new Error(`Invalid Sudoku value '${char}' at index ${index}`);
    }
    return value as CellValue;
  });
}

export function rowOf(index: number): number {
  assertIndex(index);
  return Math.floor(index / GRID_SIZE);
}

export function colOf(index: number): number {
  assertIndex(index);
  return index % GRID_SIZE;
}

export function boxOf(index: number): number {
  const row = rowOf(index);
  const col = colOf(index);
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

export function peersOf(index: number): number[] {
  const row = rowOf(index);
  const col = colOf(index);
  const peers = new Set<number>();

  for (let i = 0; i < GRID_SIZE; i += 1) {
    peers.add(row * GRID_SIZE + i);
    peers.add(i * GRID_SIZE + col);
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = boxRow; r < boxRow + 3; r += 1) {
    for (let c = boxCol; c < boxCol + 3; c += 1) {
      peers.add(r * GRID_SIZE + c);
    }
  }

  peers.delete(index);
  return [...peers];
}

export function conflictsFor(grid: Grid, index: number, value: CellValue): number[] {
  assertGrid(grid);
  assertIndex(index);
  if (value === 0) return [];
  return peersOf(index).filter((peer) => grid[peer] === value);
}

export function canPlace(grid: Grid, index: number, value: CellValue): boolean {
  return conflictsFor(grid, index, value).length === 0;
}

export function candidatesFor(grid: Grid, index: number): CellValue[] {
  assertGrid(grid);
  assertIndex(index);
  if (grid[index] !== 0) return [];

  const candidates: CellValue[] = [];
  for (let value = 1 as CellValue; value <= 9; value = (value + 1) as CellValue) {
    if (canPlace(grid, index, value)) candidates.push(value);
  }
  return candidates;
}

export function isComplete(grid: Grid): boolean {
  assertGrid(grid);
  return grid.every((value) => value !== 0);
}

export function isValidGrid(grid: Grid): boolean {
  assertGrid(grid);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = grid[index] ?? 0;
    if (value !== 0 && conflictsFor(grid, index, value).length > 0) return false;
  }
  return true;
}

export function isSolved(grid: Grid, solution: Grid): boolean {
  assertGrid(grid);
  assertGrid(solution);
  return grid.every((value, index) => value === solution[index]);
}

export function givensMask(puzzle: Grid): boolean[] {
  assertGrid(puzzle);
  return puzzle.map((value) => value !== 0);
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`Cell index out of range: ${index}`);
  }
}

function assertGrid(grid: Grid): void {
  if (grid.length !== CELL_COUNT) {
    throw new Error(`Expected ${CELL_COUNT} cells, received ${grid.length}`);
  }
}
