"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canPlace,
  colOf,
  conflictsFor,
  givensMask,
  isSolved,
  rowOf,
  type CellValue,
} from "@sudoku/domain";
import { PUZZLE, SOLUTION } from "./puzzle";
import { useSecretUnlock } from "../secret-unlock/use-secret-unlock";

const STORAGE_KEY = "sudoku:level-1:v2";

const PUZZLE_NUMBER = (() => {
  let hash = 2166136261;
  PUZZLE.forEach((value, index) => {
    hash ^= (value + 1) * (index + 17);
    hash = Math.imul(hash, 16777619);
  });
  return 1000 + ((hash >>> 0) % 9000);
})();

type NotesMap = Record<number, number[]>;

interface PersistedGame {
  grid: CellValue[];
  notes: NotesMap;
  mistakes?: number;
  startedAt?: number;
  completedAt?: number | null;
}

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function SudokuBoard({ onSecretUnlock }: { onSecretUnlock: () => void }) {
  const givens = useMemo(() => givensMask(PUZZLE), []);
  const [grid, setGrid] = useState<CellValue[]>([...PUZZLE]);
  const [notes, setNotes] = useState<NotesMap>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const gesture = useSecretUnlock(onSecretUnlock);

  useEffect(() => {
    const now = Date.now();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedGame;
        if (Array.isArray(parsed.grid) && parsed.grid.length === 81) {
          setGrid(parsed.grid as CellValue[]);
          setNotes(parsed.notes ?? {});
          setMistakes(Number.isFinite(parsed.mistakes) ? Math.max(0, Number(parsed.mistakes)) : 0);
          setStartedAt(parsed.startedAt && parsed.startedAt > 0 ? parsed.startedAt : now);
          setCompletedAt(parsed.completedAt && parsed.completedAt > 0 ? parsed.completedAt : null);
        } else {
          setStartedAt(now);
        }
      } else {
        setStartedAt(now);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setStartedAt(now);
    } finally {
      setClockNow(now);
      setHydrated(true);
    }
  }, []);

  const solved = isSolved(grid, SOLUTION);

  useEffect(() => {
    if (!hydrated || !startedAt || solved) return;
    const tick = () => setClockNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hydrated, solved, startedAt]);

  useEffect(() => {
    if (!hydrated || !solved || completedAt) return;
    const now = Date.now();
    setCompletedAt(now);
    setClockNow(now);
  }, [completedAt, hydrated, solved]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        grid,
        notes,
        mistakes,
        startedAt,
        completedAt,
      } satisfies PersistedGame),
    );
  }, [completedAt, grid, hydrated, mistakes, notes, startedAt]);

  const selectedValue = selected === null ? 0 : grid[selected] ?? 0;
  const correctCells = grid.reduce(
    (total, value, index) => total + (value !== 0 && value === SOLUTION[index] ? 1 : 0),
    0,
  );
  const elapsedSeconds =
    startedAt === null
      ? 0
      : Math.floor(((completedAt ?? (clockNow || startedAt)) - startedAt) / 1000);

  function selectCell(index: number) {
    setSelected(index);
  }

  function enterDigit(value: CellValue) {
    if (selected === null || givens[selected] || solved) return;

    if (notesMode) {
      if (grid[selected] !== 0) return;
      setNotes((current) => {
        const existing = new Set(current[selected] ?? []);
        if (existing.has(value)) existing.delete(value);
        else existing.add(value);
        return { ...current, [selected]: [...existing].sort((a, b) => a - b) };
      });
      return;
    }

    if (value !== SOLUTION[selected] && grid[selected] !== value) {
      setMistakes((current) => current + 1);
    }
    if (!canPlace(grid, selected, value)) return;

    const next = [...grid];
    next[selected] = value;
    setGrid(next);
    setNotes((current) => {
      const copy = { ...current };
      delete copy[selected];
      return copy;
    });
  }

  function erase() {
    if (selected === null || givens[selected] || solved) return;
    const next = [...grid];
    next[selected] = 0;
    setGrid(next);
    setNotes((current) => {
      const copy = { ...current };
      delete copy[selected];
      return copy;
    });
  }

  function reset() {
    const now = Date.now();
    setGrid([...PUZZLE]);
    setNotes({});
    setSelected(null);
    setNotesMode(false);
    setMistakes(0);
    setStartedAt(now);
    setCompletedAt(null);
    setClockNow(now);
  }

  return (
    <main className="page">
      <section className="sudoku-shell" aria-label="Sudoku">
        <header className="topbar sudoku-topbar">
          <div className="sudoku-brand">
            <img className="sudoku-logo" src="/icon.svg" alt="" aria-hidden="true" />
            <div>
              <h1>Sudoku</h1>
              <span>Classic · Puzzle #{PUZZLE_NUMBER}</span>
            </div>
          </div>
          <button type="button" onClick={reset}>Reset</button>
        </header>

        <div className="sudoku-stats" aria-label="Puzzle status">
          <div><span>Time</span><strong>{formatElapsed(elapsedSeconds)}</strong></div>
          <div><span>Mistakes</span><strong>{mistakes}</strong></div>
          <div><span>Progress</span><strong>{correctCells}/81</strong></div>
        </div>

        <div className="status" aria-live="polite">
          {solved ? "Completed" : notesMode ? "Notes mode" : "Playing"}
        </div>

        <div className="board" role="grid" aria-label="Sudoku board">
          {grid.map((value, index) => {
            const row = rowOf(index);
            const col = colOf(index);
            const selectedRow = selected === null ? -1 : rowOf(selected);
            const selectedCol = selected === null ? -1 : colOf(selected);
            const sameBox = selected !== null && Math.floor(row / 3) === Math.floor(selectedRow / 3) && Math.floor(col / 3) === Math.floor(selectedCol / 3);
            const related = selected !== null && (row === selectedRow || col === selectedCol || sameBox);
            const same = value !== 0 && selectedValue === value;
            const invalid = value !== 0 && (conflictsFor(grid, index, value).length > 0 || value !== SOLUTION[index]);
            const cellNotes = notes[index] ?? [];

            return (
              <button
                key={index}
                type="button"
                role="gridcell"
                aria-selected={selected === index}
                aria-label={`Row ${row + 1}, column ${col + 1}${value ? `, ${value}` : ", empty"}`}
                className={[
                  "cell",
                  givens[index] ? "given" : "",
                  selected === index ? "selected" : "",
                  selected !== index && same ? "same" : "",
                  selected !== index && !same && related ? "related" : "",
                  invalid ? "error" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => selectCell(index)}
              >
                {value !== 0 ? value : cellNotes.length > 0 ? (
                  <span className="notes" aria-hidden="true">
                    {Array.from({ length: 9 }, (_, noteIndex) => {
                      const digit = noteIndex + 1;
                      return <span className="note" key={digit}>{cellNotes.includes(digit) ? digit : ""}</span>;
                    })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="controls">
          <div className="digits" aria-label="Digits">
            {([1,2,3,4,5,6,7,8,9] as CellValue[]).map((value) => {
              const isSecretDigit = value === 5;
              return (
                <button
                  key={value}
                  className={`digit${isSecretDigit ? " secret-digit" : ""}`}
                  type="button"
                  onPointerDown={isSecretDigit ? gesture.onFivePointerDown : undefined}
                  onPointerUp={isSecretDigit ? gesture.onFivePointerUp : undefined}
                  onPointerCancel={isSecretDigit ? gesture.cancel : undefined}
                  onClick={() => {
                    if (isSecretDigit && gesture.consumeFiveClick()) return;
                    enterDigit(value);
                  }}
                >
                  {value}
                </button>
              );
            })}
          </div>
          <div className="actions">
            <button className="action" type="button" onClick={erase}>Erase</button>
            <button className={`action ${notesMode ? "active" : ""}`} type="button" onClick={() => setNotesMode((v) => !v)}>Notes</button>
            <button className="action" type="button" onClick={() => setSelected(null)}>Clear</button>
          </div>
        </div>
      </section>
    </main>
  );
}
