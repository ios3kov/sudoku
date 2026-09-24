import { createRoot } from "react-dom/client";
import { VideoAttachment } from "../../../features/messenger/video-attachment";
const root = createRoot(document.getElementById("root")!);
let releaseCount = 0;
let finish: (() => void) | null = null;
let provide: ((file: File) => void) | null = null;
const calls: {id: string; mimeType: string; base64: string}[] = [];
const stops: string[] = [];
const sample = () => new File([new Uint8Array([1, 2, 3])], "clip.mp4", {type: "video/mp4"});
function mount(late = false) {
  window.SudokuNativeVideo = {
    play: payload => { calls.push(payload); return new Promise(resolve => { finish = () => resolve(true); }); },
    stop: async id => { stops.push(id); finish?.(); },
  };
  root.render(<VideoAttachment name="clip.mp4" onLoad={() => late ? new Promise(resolve => { provide = resolve; }) : Promise.resolve(sample())}
    onRelease={() => { releaseCount += 1; }} />);
}
async function mountWeb() {
  delete window.SudokuNativeVideo;
  const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 18;
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(10);
  const recorder = new MediaRecorder(stream, {mimeType: "video/webm"});
  const chunks: Blob[] = [];
  const blob = await new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.onstop = () => resolve(new Blob(chunks, {type: "video/webm"}));
    recorder.onerror = () => reject(new Error("Fixture encoding failed"));
    recorder.start();
    context.fillStyle = "red"; context.fillRect(0, 0, 32, 18);
    window.setTimeout(() => recorder.stop(), 300);
  });
  stream.getTracks().forEach(track => track.stop());
  root.render(<VideoAttachment name="sample.webm" onLoad={async () => new File([blob], "sample.webm", {type: blob.type})}
    onRelease={() => { releaseCount += 1; }} />);
}
window.__videoTest = {
  mount, mountWeb, calls, stops, finish: () => finish?.(), provide: () => provide?.(sample()),
  unmount: () => root.unmount(), releases: () => releaseCount,
};
declare global { interface Window { __videoTest: {
  mountWeb: typeof mountWeb; mount: typeof mount; calls: typeof calls; stops: string[]; finish: () => void; provide: () => void;
  unmount: () => void; releases: () => number;
} } }
