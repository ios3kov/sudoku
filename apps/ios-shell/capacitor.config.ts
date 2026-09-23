import type { CapacitorConfig } from "@capacitor/cli";

const remoteUrl = process.env.SUDOKU_IOS_REMOTE_URL?.trim();

if (remoteUrl && remoteUrl !== "https://sudoku.moscow") {
  throw new Error("SUDOKU_IOS_REMOTE_URL must be exactly https://sudoku.moscow");
}

const config: CapacitorConfig = {
  appId: "media.artdirector.sudoku",
  appName: "Sudoku",
  webDir: "www",
  loggingBehavior: "debug",
  ...(remoteUrl
    ? {
        // Prototype/device-test mode only. Capacitor explicitly documents
        // server.url as a live-reload/development facility, not a production
        // App Store delivery mechanism.
        server: {
          url: remoteUrl,
          cleartext: false,
        },
      }
    : {}),
};

export default config;
