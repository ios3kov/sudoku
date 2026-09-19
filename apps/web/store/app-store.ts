"use client";

import { create } from "zustand";

type VisibleMode = "sudoku" | "messenger-lock";

interface AppState {
  mode: VisibleMode;
  showMessengerLock: () => void;
  hidePrivateSurface: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: "sudoku",
  showMessengerLock: () => set({ mode: "messenger-lock" }),
  hidePrivateSurface: () => set({ mode: "sudoku" }),
}));
