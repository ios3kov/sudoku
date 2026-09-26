"use client";

export function SudokuEscapeButton({ onHide }: { onHide: () => void }) {
  return (
    <button
      type="button"
      className="sudoku-escape-button"
      onClick={onHide}
      aria-label="Hide messenger and return to Sudoku"
      title="Sudoku"
    >
      <span className="sudoku-escape-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </span>
    </button>
  );
}
