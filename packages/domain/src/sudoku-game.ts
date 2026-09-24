/** Offline Sudoku. Uniqueness-preserving clue removal adapted from cnkang/sudoku;
 * see THIRD_PARTY_NOTICES.md. Difficulty is a clue-density target, not a rating. */
export type SudokuSize = 4 | 6 | 9;
export type SudokuDifficulty = "easy" | "medium" | "hard";
export interface GamePuzzle {
    size: SudokuSize;
    difficulty: SudokuDifficulty;
    seed: number;
    givens: number[];
    solution: number[];
}
interface GameSnapshot {
    values: number[];
    notes: number[][];
}
export interface SudokuGame extends GameSnapshot {
    version: 1;
    puzzle: GamePuzzle;
    mistakes: number;
    hints: number;
    elapsedSeconds: number;
    paused: boolean;
    history: GameSnapshot[];
    future: GameSnapshot[];
}
export type SudokuAction = {
    type: "digit";
    index: number;
    value: number;
    notes?: boolean;
} | {
    type: "erase";
    index: number;
} | {
    type: "hint";
    index?: number;
} | {
    type: "undo";
} | {
    type: "redo";
} | {
    type: "pause";
} | {
    type: "resume";
} | {
    type: "clear";
} | {
    type: "tick";
    seconds: number;
};
export function sudokuBoxDimensions(size: SudokuSize): [
    number,
    number
] { return size === 9 ? [3, 3] : size === 6 ? [2, 3] : [2, 2]; }
function peers(size: SudokuSize, index: number): number[] {
    const [height, width] = sudokuBoxDimensions(size), row = Math.floor(index / size), col = index % size;
    return Array.from({ length: size * size }, (_, i) => i).filter(i => i !== index && (Math.floor(i / size) === row || i % size === col || (Math.floor(Math.floor(i / size) / height) === Math.floor(row / height) && Math.floor(i % size / width) === Math.floor(col / width))));
}
/** Returns 0, 1, or 2 (multiple OR work-budget exhausted). Never falsely certifies uniqueness. */
export function countGameSolutions(values: readonly number[], size: SudokuSize, budget = 40000): number {
    if (![4, 6, 9].includes(size) || values.length !== size * size || values.some(v => !Number.isInteger(v) || v < 0 || v > size))
        return 0;
    const board = [...values], links = board.map((_, i) => peers(size, i));
    if (board.some((v, i) => v !== 0 && links[i]!.some(j => board[j] === v)))
        return 0;
    let nodes = 0, count = 0, exhausted = false;
    function visit(): void {
        if (++nodes > budget) {
            exhausted = true;
            return;
        }
        let selected = -1, options: number[] = [];
        for (let i = 0; i < board.length; i++)
            if (board[i] === 0) {
                const used = new Set(links[i]!.map(j => board[j]));
                const available = Array.from({ length: size }, (_, n) => n + 1).filter(n => !used.has(n));
                if (!available.length)
                    return;
                if (selected === -1 || available.length < options.length) {
                    selected = i;
                    options = available;
                }
                if (options.length === 1)
                    break;
            }
        if (selected === -1) {
            count++;
            return;
        }
        for (const value of options) {
            board[selected] = value;
            visit();
            board[selected] = 0;
            if (count >= 2 || exhausted)
                return;
        }
    }
    visit();
    return exhausted ? 2 : Math.min(count, 2);
}
export function generateGamePuzzle(size: SudokuSize = 9, difficulty: SudokuDifficulty = "medium", seed = Math.floor(Math.random() * 0x100000000)): GamePuzzle {
    if (![4, 6, 9].includes(size) || !["easy", "medium", "hard"].includes(difficulty) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new Error("Invalid Sudoku configuration");
    let randomState = seed >>> 0;
    const random = () => { randomState = (randomState + 0x6d2b79f5) >>> 0; let t = randomState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const shuffle = (items: number[]) => { for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j]!, items[i]!];
    } return items; };
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);
    const [height, width] = sudokuBoxDimensions(size);
    const rows = shuffle(range(size / height)).flatMap(b => shuffle(range(height)).map(r => b * height + r));
    const cols = shuffle(range(size / width)).flatMap(b => shuffle(range(width)).map(c => b * width + c));
    const digits = shuffle(range(size).map(i => i + 1));
    const solution = rows.flatMap(r => cols.map(c => digits[(width * (r % height) + Math.floor(r / height) + c) % size]!));
    const givens = [...solution], target = Math.ceil(size * size * ({ easy: 0.58, medium: 0.46, hard: 0.34 }[difficulty]));
    let remaining = givens.length;
    for (const index of shuffle(range(givens.length))) {
        if (remaining <= target)
            break;
        const original = givens[index]!;
        givens[index] = 0;
        if (countGameSolutions(givens, size) === 1)
            remaining--;
        else
            givens[index] = original;
    }
    return { size, difficulty, seed, givens, solution };
}
export function createSudokuGame(puzzle: GamePuzzle): SudokuGame {
    return { version: 1, puzzle: structuredClone(puzzle), values: [...puzzle.givens], notes: puzzle.givens.map(() => []), mistakes: 0, hints: 0, elapsedSeconds: 0, paused: false, history: [], future: [] };
}
export function isSudokuGameComplete(game: SudokuGame): boolean { return game.values.every((v, i) => v === game.puzzle.solution[i]); }
function snapshot(game: GameSnapshot): GameSnapshot { return { values: [...game.values], notes: game.notes.map(n => [...n]) }; }
export function applySudokuAction(game: SudokuGame, action: SudokuAction): SudokuGame {
    const complete = isSudokuGameComplete(game);
    if (action.type === "pause" || action.type === "resume")
        return { ...game, paused: action.type === "pause" };
    if (action.type === "tick")
        return game.paused || complete || !Number.isInteger(action.seconds) || action.seconds < 0 ? game : { ...game, elapsedSeconds: Math.min(31536000, game.elapsedSeconds + action.seconds) };
    if (game.paused)
        return game;
    if (action.type === "undo" || action.type === "redo") {
        const source = action.type === "undo" ? game.history : game.future, last = source.at(-1);
        if (!last)
            return game;
        return { ...game, ...snapshot(last), history: action.type === "undo" ? source.slice(0, -1) : [...game.history, snapshot(game)].slice(-100), future: action.type === "redo" ? source.slice(0, -1) : [...game.future, snapshot(game)].slice(-100) };
    }
    if (complete)
        return game;
    const next = { ...game, ...snapshot(game) };
    if (action.type === "clear") {
        next.values = [...game.puzzle.givens];
        next.notes = game.notes.map(() => []);
    }
    else {
        const index = action.type === "hint" ? (action.index ?? game.values.findIndex((v, i) => v !== game.puzzle.solution[i])) : action.index;
        if (!Number.isInteger(index) || index < 0 || index >= game.values.length || game.puzzle.givens[index] !== 0)
            return game;
        if (action.type === "erase") {
            next.values[index] = 0;
            next.notes[index] = [];
        }
        else if (action.type === "digit" && action.notes) {
            if (next.values[index] !== 0 || !Number.isInteger(action.value) || action.value < 1 || action.value > game.puzzle.size)
                return game;
            const notes = next.notes[index]!;
            next.notes[index] = notes.includes(action.value) ? notes.filter(n => n !== action.value) : [...notes, action.value].sort((a, b) => a - b);
        }
        else {
            const value = action.type === "hint" ? game.puzzle.solution[index]! : action.value;
            if (!Number.isInteger(value) || value < 1 || value > game.puzzle.size || next.values[index] === value)
                return game;
            next.values[index] = value;
            next.notes[index] = [];
            if (action.type === "hint")
                next.hints++;
            else if (value !== game.puzzle.solution[index])
                next.mistakes++;
            if (value === game.puzzle.solution[index])
                for (const peer of peers(game.puzzle.size, index))
                    next.notes[peer] = next.notes[peer]!.filter(n => n !== value);
        }
    }
    if (JSON.stringify(snapshot(next)) === JSON.stringify(snapshot(game)))
        return game;
    next.history = [...game.history, snapshot(game)].slice(-100);
    next.future = [];
    return next;
}
/** Strictly validate persisted input before it reaches the UI; history is bounded. */
export function parseSudokuGame(input: unknown): SudokuGame | null {
    try {
        const g = input as SudokuGame, p = g.puzzle;
        if (g.version !== 1 || ![4, 6, 9].includes(p.size) || !["easy", "medium", "hard"].includes(p.difficulty) || !Number.isSafeInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff)
            return null;
        const validValues = (v: unknown): v is number[] => Array.isArray(v) && v.length === p.size * p.size && v.every(n => Number.isInteger(n) && n >= 0 && n <= p.size);
        if (!validValues(p.givens) || !validValues(p.solution) || p.solution.includes(0) || countGameSolutions(p.solution, p.size) !== 1 || countGameSolutions(p.givens, p.size) !== 1 || p.givens.some((n, i) => n !== 0 && n !== p.solution[i]))
            return null;
        const validSnapshot = (s: GameSnapshot) => validValues(s.values) && p.givens.every((v, i) => v === 0 || s.values[i] === v) && Array.isArray(s.notes) && s.notes.length === s.values.length && s.notes.every((a, i) => Array.isArray(a) && a.length <= p.size && new Set(a).size === a.length && a.every(n => Number.isInteger(n) && n >= 1 && n <= p.size) && (s.values[i] === 0 || a.length === 0));
        if (!validSnapshot(g) || ![g.mistakes, g.hints, g.elapsedSeconds].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 31536000) || typeof g.paused !== "boolean" || ![g.history, g.future].every(a => Array.isArray(a) && a.length <= 100 && a.every(validSnapshot)))
            return null;
        return structuredClone(g);
    }
    catch {
        return null;
    }
}
