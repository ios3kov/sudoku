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

const STORAGE_KEY = "sudoku:level-1:v1";

type NotesMap = Record<number, number[]>;

interface PersistedGame {
  grid: CellValue[];
  notes: NotesMap;
}

export function SudokuBoard({ onSecretUnlock }: { onSecretUnlock: () => void }) {
  const givens = useMemo(() => givensMask(PUZZLE), []);
  const [grid, setGrid] = useState<CellValue[]>([...PUZZLE]);
  const [notes, setNotes] = useState<NotesMap>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const gesture = useSecretUnlock(onSecretUnlock);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedGame;
        if (Array.isArray(parsed.grid) && parsed.grid.length === 81) {
          setGrid(parsed.grid as CellValue[]);
          setNotes(parsed.notes ?? {});
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ grid, notes } satisfies PersistedGame));
  }, [grid, notes, hydrated]);

  const solved = isSolved(grid, SOLUTION);
  const selectedValue = selected === null ? 0 : grid[selected] ?? 0;

  function selectCell(index: number) {
    setSelected(index);
    if ((grid[index] ?? 0) === 5) gesture.arm();
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
    setGrid([...PUZZLE]);
    setNotes({});
    setSelected(null);
  }

  return (
    <main className="page">
      <section className="sudoku-shell" aria-label="Sudoku">
        <header className="topbar">
          <h1>Sudoku</h1>
          <button type="button" onClick={reset}>Reset</button>
        </header>

        <div className="status" aria-live="polite">
          {solved ? "Completed" : notesMode ? "Notes mode" : "Level 1"}
        </div>

        <div
          className="board"
          role="grid"
          aria-label="Sudoku board"
          onPointerDown={gesture.onPointerDown}
          onPointerUp={gesture.onPointerUp}
          onPointerCancel={gesture.cancel}
        >
          {grid.map((value, index) => {
            const row = rowOf(index);
            const col = colOf(index);
            const selectedRow = selected === null ? -1 : rowOf(selected);
            const selectedCol = selected === null ? -1 : colOf(selected);
            const sameBox = selected !== null && Math.floor(row / 3) === Math.floor(selectedRow / 3) && Math.floor(col / 3) === Math.floor(selectedCol / 3);
            const related = selected !== null && (row === selectedRow || col === selectedCol || sameBox);
            const same = value !== 0 && selectedValue === value;
            const invalid = value !== 0 && conflictsFor(grid, index, value).length > 0;
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
            {([1,2,3,4,5,6,7,8,9] as CellValue[]).map((value) => (
              <button key={value} className="digit" type="button" onClick={() => enterDigit(value)}>{value}</button>
            ))}
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
