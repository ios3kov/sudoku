"use client";

import { useEffect, useState } from "react";
import { applySudokuAction, createSudokuGame, generateGamePuzzle, isSudokuGameComplete, isSudokuGameLost, sudokuBoxDimensions, type SudokuAction, type SudokuDifficulty, type SudokuGame, type SudokuSize, type SudokuMode } from "@sudoku/domain";
import { GameDialog, GameIcon } from "./game-dialog";
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
function recordBest(game: SudokuGame): number | null {
  try {
    const key = `sudoku:best:v1:${game.mode ?? "free"}:${game.puzzle.size}:${game.puzzle.difficulty}`;
    const raw = localStorage.getItem(key);
    const previous = raw === null ? NaN : Number(raw);
    const best = Number.isSafeInteger(previous) && previous >= 0 ? Math.min(previous, game.elapsedSeconds) : game.elapsedSeconds;
    localStorage.setItem(key, String(best));
    return best;
  } catch { return null; }
}
function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function SudokuBoard({
  active = true,
  onReady,
  onSecretUnlock
}: {
  active?: boolean;
  onReady?: () => void;
  onSecretUnlock: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [saved, setSaved] = useState<SudokuGame | null>(null);
  const [size, setSize] = useState<SudokuSize>(9);
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [mode, setMode] = useState<SudokuMode>("free");
  const [best, setBest] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuStep, setMenuStep] = useState<"home" | "setup" | "replace">("home");
  const {
    setScreenElement,
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel
  } = useSecretUnlock({
    enabled: active,
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
    onReady?.();
  }, [onReady]);
  function update(next: Session) {
    retainSession(next);
    setSession(next);
    if (next.autosave && next.game) {
      if (saveGame(next.game)) setSaved(next.game);else setNotice("Storage is unavailable. Keep this window open to retain your game.");
    }
  }
  function act(action: SudokuAction) {
    if (!session?.game) return;
    const next = applySudokuAction(session.game, action);
    if (!isSudokuGameComplete(session.game) && isSudokuGameComplete(next)) setBest(recordBest(next));
    update({
      ...session,
      game: next
    });
  }
  const game = session?.game;
  const solved = game ? isSudokuGameComplete(game) : false;
  const lost = game ? isSudokuGameLost(game) : false;
  const clockRunning = Boolean(active && game && !game.paused && !solved && !lost && session?.screen === "game");
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
  function start(replay = false) {
    setMenuStep("home");
    const next = replay && game ? createSudokuGame(generateGamePuzzle(game.puzzle.size, game.puzzle.difficulty), game.mode ?? "free") : createSudokuGame(generateGamePuzzle(size, difficulty), mode);
    setSelected(null);
    setNotesMode(false);
    setNotice("");
    setBest(null);
    update({
      game: next,
      screen: "game",
      autosave: true
    });
  }
  function menu() {
    setMenuStep("home");
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
  return <main
    ref={setScreenElement}
    className={`page sudoku-reveal-screen sudoku-game${session?.screen === "menu" ? " is-menu" : ""}`}
    aria-hidden={active ? undefined : true}
    inert={active ? undefined : true}
  >
    <section className="sudoku-shell" aria-label="Sudoku">
      <header className={`topbar sudoku-topbar${session?.screen !== "game" ? " sudoku-home-header" : ""}`}>
        {session?.screen !== "game" && <div
          className="sudoku-brand"><span
          className="sudoku-logo"
          aria-hidden="true" /><div><h1>SUDOKU.MOSCOW</h1><span
          className="sudoku-identity">Select mode</span></div></div>}
        {session?.screen === "game" && <div className="sudoku-header-actions">
          <button type="button" aria-label="Menu" onClick={menu}><GameIcon name="menu" /></button>
          <strong>SUDOKU.MOSCOW</strong>
          <button type="button" aria-label="Pause" disabled={solved || lost || game?.paused} onClick={() => act({ type: "pause" })}><GameIcon name="pause" /></button>
        </div>}
      </header>
      <div className="game-content">
        {!session ? <p role="status">Loading game…</p> : session.screen === "menu" ? <div className="sudoku-menu">
          {menuStep === "home" && <>
          {session.game && <button className="primary-button" onClick={() => update({
            ...session,
            game: { ...session.game!, paused: false },
            screen: "game"
          })}>Continue</button>}
          {saved && (!session.game || (!session.autosave && JSON.stringify(session.game.puzzle) !== JSON.stringify(saved.puzzle))) && <button className={session.game ? "secondary-button" : "primary-button"} onClick={() => {
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
          }}>{session.game ? "Saved game" : "Continue"}</button>}
          {(["free", "challenge"] as SudokuMode[]).map(value => <button key={value} className={`mode-card ${value}`} aria-label={value === "free" ? "Free Mode" : "Challenge Mode"} onClick={() => { setMode(value); setMenuStep("setup"); }}>
            <span className="mode-emblem"><GameIcon name={value === "free" ? "play" : "timer"} /></span>
            <strong>{value === "free" ? "Free Mode" : "Challenge Mode"}</strong>
            <span>{value === "free" ? "Enjoy Sudoku freely" : "Mistakes will reduce your life"}</span>
            <small>{value === "free" ? "No time limit · Unlimited lives" : "3 mistakes limit · Beat your time"}</small>
          </button>)}
          </>}
          {menuStep === "setup" && <>
          <button className="secondary-button" onClick={() => setMenuStep("home")}>Back</button>
          <h2>{mode === "free" ? "Free Mode" : "Challenge Mode"}</h2>
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
          <button className="primary-button" onClick={() => saved && !isSudokuGameComplete(saved) && !isSudokuGameLost(saved) ? setMenuStep("replace") : start()}>Start game</button>
          </>}
          {menuStep === "replace" && <GameDialog title="Replace saved game?" onClose={() => setMenuStep("setup")}>
            <p>Your saved progress will be replaced by the new puzzle.</p>
            <button className="primary-button" onClick={() => start()}>Start new game</button>
            <button className="secondary-button" onClick={() => setMenuStep("setup")}>Cancel</button>
          </GameDialog>}
          {menuStep === "home" && session.game && !session.autosave && <><p>Your quick game is kept for this visit. Save it to continue another day; this replaces the previous saved game.</p><button
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
        </div> : game && <>
          <div
            className="sudoku-stats"
            aria-label="Puzzle status"><div><span>Difficulty</span><strong>{game.puzzle.difficulty.toUpperCase()}</strong></div><div><span>Timer</span><strong>{formatElapsed(game.elapsedSeconds)}</strong></div><div><span>Mistakes</span>{game.mode === "challenge" ? <div className="life-gauge" role="img" aria-label={`${Math.max(0, 3 - game.mistakes)} lives remaining`}>{[1, 2, 3].map(life => <i key={life} className={game.mistakes >= life ? "lost" : ""} />)}</div> : <strong aria-label={`${game.mistakes} mistakes, unlimited lives`}>-</strong>}</div></div>
          <div className="sudoku-status-announcement" aria-live="polite">{game.paused ? "Paused" : solved ? "Completed" : notesMode ? "Notes mode" : "Playing"}</div>
          {game.paused && <GameDialog title="Paused" onClose={() => act({ type: "resume" })}><button className="primary-button" onClick={() => act({
              type: "resume"
            })}>Resume</button><button className="secondary-button" onClick={menu}>Return to menu</button></GameDialog>}
          {(solved || lost) && <GameDialog title={lost ? "Challenge over" : "Mission complete"} onClose={menu}>
            <div className={`result-emblem${lost ? " failed" : ""}`}><GameIcon name={lost ? "timer" : "award"} /></div>
            <p className="result-subtitle">{lost ? "Three mistakes · Try again" : "Grid mastered"}</p>
            <div className="result-stats"><div><span>Time</span><strong>{formatElapsed(game.elapsedSeconds)}</strong></div><div><span>Mistakes</span><strong>{game.mistakes}</strong></div><div><span>Difficulty</span><strong>{game.puzzle.difficulty}</strong></div><div><span>Mode</span><strong>{game.mode ?? "free"}</strong></div></div>
            {!lost && best !== null && <p className="result-subtitle">{best === game.elapsedSeconds ? "Personal best" : "Best time"} · {formatElapsed(best)}</p>}
            <button className="primary-button" onClick={() => { if (lost) { update({ ...session, game: createSudokuGame(game.puzzle, game.mode ?? "free") }); setSelected(null); setNotesMode(false); } else start(true); }}>{lost ? "Try again" : "New game"}</button>
            <button className="secondary-button" onClick={menu}>Return to menu</button>
          </GameDialog>}
          <>
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
                gridTemplateColumns: `repeat(${game.puzzle.size === 4 ? 2 : 3},minmax(0,1fr))`
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
                }}><GameIcon name="erase" />Erase</button>
              <button className={`action${notesMode ? " active" : ""}`} aria-pressed={notesMode} onClick={() => setNotesMode(!notesMode)}><GameIcon name="notes" />Notes</button>
              <button className="action" disabled={!game.history.length} onClick={() => act({
                  type: "undo"
                })}><GameIcon name="undo" />Undo</button>

            </div></div>
          </>
        </>}
        {notice && <p className="game-notice" role="status">{notice}</p>}
      </div>
    </section>
  </main>;
}
