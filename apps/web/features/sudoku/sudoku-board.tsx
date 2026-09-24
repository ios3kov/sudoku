"use client";

import { useEffect, useState } from "react";
import { applySudokuAction, createSudokuGame, generateGamePuzzle, isSudokuGameComplete, sudokuBoxDimensions, type SudokuAction, type SudokuDifficulty, type SudokuGame, type SudokuSize } from "@sudoku/domain";
import { useSecretUnlock } from "../secret-unlock/use-secret-unlock";
import { readSudokuStartupPreference } from "./startup-preference";
import { SUDOKU_GAME_STORAGE_KEY, readSavedSudokuGame } from "./saved-game";
import { PUZZLE, SOLUTION } from "./puzzle";
interface Session {
  game: SudokuGame | null;
  screen: "menu" | "game";
  autosave: boolean;
}
// Survives private-surface mounting and privacy covers, but deliberately not a cold reload.
let pageSession: Session | null = null;
function retainSession(next: Session) {
  pageSession = next;
}
function readSaved(): SudokuGame | null {
  try {
    return readSavedSudokuGame(localStorage, {givens: PUZZLE, solution: SOLUTION});
  } catch {
    return null;
  }
}
function saveGame(game: SudokuGame): boolean {
  try {
    localStorage.setItem(SUDOKU_GAME_STORAGE_KEY, JSON.stringify(game));
    return true;
  } catch {
    return false;
  }
}
function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function SudokuBoard({
  onSecretUnlock
}: {
  onSecretUnlock: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [saved, setSaved] = useState<SudokuGame | null>(null);
  const [size, setSize] = useState<SudokuSize>(9);
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [notice, setNotice] = useState("");
  const {
    setScreenElement,
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel
  } = useSecretUnlock({
    onUnlock: onSecretUnlock
  });
  useEffect(() => {
    const stored = readSaved();
    const initial = pageSession ?? (readSudokuStartupPreference() === "quick-play" ? {
      game: createSudokuGame(generateGamePuzzle(9, "easy")),
      screen: "game" as const,
      autosave: false
    } : {
      game: null,
      screen: "menu" as const,
      autosave: false
    });
    retainSession(initial);
    // Browser-only startup and saved game hydration must follow the identical SSR placeholder.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(initial);
    setSaved(stored);
  }, []);
  function update(next: Session) {
    retainSession(next);
    setSession(next);
    if (next.autosave && next.game) {
      if (saveGame(next.game)) setSaved(next.game);else setNotice("Storage is unavailable. Keep this window open to retain your game.");
    }
  }
  function act(action: SudokuAction) {
    if (!session?.game) return;
    update({
      ...session,
      game: applySudokuAction(session.game, action)
    });
  }
  const game = session?.game;
  const solved = game ? isSudokuGameComplete(game) : false;
  const clockRunning = Boolean(game && !game.paused && !solved && session?.screen === "game");
  useEffect(() => {
    if (!clockRunning) return;
    // Count only visible playing time; background, menu and privacy surfaces do not run the clock.
    let previous = performance.now();
    const resetClockBaseline = () => {
      previous = performance.now();
    };
    document.addEventListener("visibilitychange", resetClockBaseline);
    window.addEventListener("pageshow", resetClockBaseline);
    const timer = window.setInterval(() => {
      const now = performance.now();
      const seconds = Math.floor((now - previous) / 1000);
      if (!seconds) return;
      previous += seconds * 1000;
      if (document.visibilityState !== "visible" || !pageSession?.game) return;
      const next = {
        ...pageSession,
        game: applySudokuAction(pageSession.game, {
          type: "tick",
          seconds
        })
      };
      retainSession(next);
      setSession(next);
      if (next.autosave) saveGame(next.game);
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resetClockBaseline);
      window.removeEventListener("pageshow", resetClockBaseline);
    };
  }, [clockRunning]);
  function start() {
    const next = createSudokuGame(generateGamePuzzle(size, difficulty));
    setSelected(null);
    setNotesMode(false);
    setNotice("");
    update({
      game: next,
      screen: "game",
      autosave: true
    });
  }
  function menu() {
    if (session) update({
      ...session,
      screen: "menu"
    });
    cancel();
    setSelected(null);
  }
  function enter(value: number) {
    if (selected !== null) act({
      type: "digit",
      index: selected,
      value,
      notes: notesMode
    });
  }
  const selectedValue = selected === null ? 0 : game?.values[selected] ?? 0;
  const [boxHeight, boxWidth] = sudokuBoxDimensions(game?.puzzle.size ?? 9);
  const playable = game?.puzzle.givens.filter(v => !v).length ?? 0;
  const completed = game?.values.filter((v, i) => !game.puzzle.givens[i] && v === game.puzzle.solution[i]).length ?? 0;
  return <main ref={setScreenElement} className="page sudoku-reveal-screen sudoku-game">
    <section className="sudoku-shell" aria-label="Sudoku">
      <header className="topbar sudoku-topbar">
        <div
          className="sudoku-brand"><span
          className="sudoku-logo"
          aria-hidden="true" /><div><h1>Sudoku</h1><span
          className="sudoku-identity">{session?.screen === "game" && game ? `${game.puzzle.size}×${game.puzzle.size} · ${game.puzzle.difficulty}` : "A little focus, every day"}</span></div></div>
        {session?.screen === "game" && <div className="sudoku-header-actions">
          {!game?.paused && <button type="button" disabled={solved} onClick={() => act({
            type: "pause"
          })}>Pause</button>}
          <button type="button" onClick={menu}>Menu</button>
        </div>}
      </header>
      <div className="game-content">
        {!session ? <p role="status">Loading game…</p> : session.screen === "menu" ? <div className="sudoku-menu">
          <h2>Your next puzzle</h2>
          {session.game && <button className="secondary-button" onClick={() => update({
            ...session,
            screen: "game"
          })}>Back to game</button>}
          {session.game && <button className="secondary-button" onClick={() => {
            update({
              ...session,
              game: createSudokuGame(session.game!.puzzle),
              screen: "game"
            });
            setSelected(null);
            setNotesMode(false);
          }}>Reset</button>}
          {saved && <button className="secondary-button" onClick={() => {
            setSelected(null);
            setNotesMode(false);
            update({
              game: {
                ...saved,
                paused: false
              },
              screen: "game",
              autosave: true
            });
          }}>Continue saved game · {saved.puzzle.size}×{saved.puzzle.size}</button>}
          <fieldset><legend>Board size</legend><div
            className="sudoku-options">{([4, 6, 9] as SudokuSize[]).map(value => <button key={value}
            className="secondary-button"
            aria-pressed={size === value}
            onClick={() => setSize(value)}>{value}×{value}</button>)}</div></fieldset>
          <fieldset><legend>Difficulty</legend><div
            className="sudoku-options">{(["easy", "medium", "hard"] as SudokuDifficulty[]).map(value => <button key={value}
            className="secondary-button"
            aria-pressed={difficulty === value}
            onClick={() => setDifficulty(value)}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}</div></fieldset>
          {saved && <p>Starting a new game replaces your saved game.</p>}
          <button className="primary-button" onClick={start}>New game</button>
          {session.game && !session.autosave && <><p>Your quick game is kept for this visit. Save it to continue another day; this replaces the previous saved game.</p><button
            className="secondary-button"
            onClick={() => {
              if (session.game && saveGame(session.game)) {
                update({
                  ...session,
                  autosave: true
                });
                setNotice("Game saved on this device.");
              } else setNotice("Storage is unavailable. Keep this window open to retain your game.");
            }}>Save this game</button></>}
          <details><summary>How to play</summary><p>Fill each row, column and outlined box with the digits shown below the board, using each digit once.</p><ol><li>Select an empty square, then a digit.</li><li>Use Notes to record possible digits.</li><li>Hint fills one square. Undo and Redo let you revisit moves.</li></ol><p>Difficulty changes the number of starting clues. Every generated puzzle has one solution. Progress stays on this device.</p></details>
        </div> : game && <>
          <div
            className="sudoku-stats"
            aria-label="Puzzle status"><div><span>Time</span><strong>{formatElapsed(game.elapsedSeconds)}</strong></div><div><span>Mistakes</span><strong>{game.mistakes}</strong></div><div><span>Progress</span><strong>{completed}/{playable}</strong></div></div>
          <div className="status" aria-live="polite">{game.paused ? "Paused" : solved ? "Completed" : notesMode ? "Notes mode" : "Playing"}</div>
          {game.paused ? <div className="sudoku-paused"><h2>Take a breath</h2><button className="primary-button" onClick={() => act({
              type: "resume"
            })}>Resume</button></div> : <>
            <div className="board" role="grid" aria-label="Sudoku board" style={{
              gridTemplateColumns: `repeat(${game.puzzle.size},minmax(0,1fr))`
            }}>
              {game.values.map((value, index) => {
                const row = Math.floor(index / game.puzzle.size),
                  col = index % game.puzzle.size;
                const sr = selected === null ? -1 : Math.floor(selected / game.puzzle.size),
                  sc = selected === null ? -1 : selected % game.puzzle.size;
                const related = selected !== null && (row === sr || col === sc || Math.floor(row / boxHeight) === Math.floor(sr / boxHeight) && Math.floor(col / boxWidth) === Math.floor(sc / boxWidth));
                const given = game.puzzle.givens[index] !== 0,
                  invalid = value !== 0 && value !== game.puzzle.solution[index],
                  cellNotes = game.notes[index] ?? [];
                return <button key={index} type="button"
                  role="gridcell"
                  aria-selected={selected === index}
                  aria-readonly={given}
                  aria-invalid={invalid || undefined}
                  aria-label={`Row ${row + 1}, column ${col + 1}${value ? `, ${value}` : ", empty"}${given ? ", given" : ""}${cellNotes.length ? `, notes ${cellNotes.join(", ")}` : ""}`}
                  className={["cell", given ? "given" : "", selected === index ? "selected" : "", selected !== index && value !== 0 && selectedValue === value ? "same" : "", selected !== index && related ? "related" : "", invalid ? "invalid" : "", (col + 1) % boxWidth === 0 && col < game.puzzle.size - 1 ? "box-right" : "", (row + 1) % boxHeight === 0 && row < game.puzzle.size - 1 ? "box-bottom" : ""].filter(Boolean).join(" ")}
                  onClick={() => setSelected(index)}>{value || (cellNotes.length ? <span
                  className="notes"
                  aria-hidden="true">{Array.from({
                      length: game.puzzle.size
                    }, (_, i) => <span className="note" key={i}>{cellNotes.includes(i + 1) ? i + 1 : ""}</span>)}</span> : null)}</button>;
              })}
            </div>
            <div className="controls"><div className="digits" aria-label="Digits" style={{
                gridTemplateColumns: `repeat(${game.puzzle.size},minmax(0,1fr))`
              }}>
              {Array.from({
                  length: game.puzzle.size
                }, (_, i) => i + 1).map(value => <button key={value}
                  className={`digit${value === 5 ? " secret-digit" : ""}`} type="button"
                  onPointerDown={value === 5 ? onFivePointerDown : undefined}
                  onPointerMove={value === 5 ? onFivePointerMove : undefined}
                  onPointerUp={value === 5 ? onFivePointerUp : undefined}
                  onPointerCancel={value === 5 ? cancel : undefined}
                  onClick={() => {
                  if (value === 5 && consumeFiveClick()) return;
                  enter(value);
                }}>{value}</button>)}
            </div><div className="actions">
              <button className="action" disabled={solved || selected === null} onClick={() => {
                  if (selected !== null) act({
                    type: "erase",
                    index: selected
                  });
                }}>Erase</button>
              <button className={`action${notesMode ? " active" : ""}`} aria-pressed={notesMode} onClick={() => setNotesMode(!notesMode)}>Notes</button>
              <button className="action" onClick={() => setSelected(null)}>Clear</button>
              <button className="action" disabled={!game.history.length} onClick={() => act({
                  type: "undo"
                })}>Undo</button>
              <button className="action" disabled={!game.future.length} onClick={() => act({
                  type: "redo"
                })}>Redo</button>
              <button className="action" disabled={solved} aria-label={`Hint (${game.hints} used)`} onClick={() => act({
                  type: "hint",
                  index: selected !== null && !game.puzzle.givens[selected] && game.values[selected] !== game.puzzle.solution[selected] ? selected : undefined
                })}>Hint</button>

            </div></div>
          </>}
        </>}
        {notice && <p className="game-notice" role="status">{notice}</p>}
      </div>
    </section>
  </main>;
}
