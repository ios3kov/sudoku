export interface SudokuSelectedContact {
  name?: string[];
  tel?: string[];
}

export interface SudokuNativePlugin {
  selectContacts(): Promise<{ contacts: SudokuSelectedContact[] }>;
  canAuthenticate(): Promise<{ available: boolean; biometry: "faceId" | "touchId" | "opticId" | "none" }>;
  authenticate(options: { reason: string }): Promise<{ authenticated: boolean }>;
}
