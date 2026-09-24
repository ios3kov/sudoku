import { createVoiceRecorder } from "../../../features/messenger/voice-recording";

async function recordSample() {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  destination.channelCount = 1;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.1;
  oscillator.connect(gain).connect(destination);
  let recorder: MediaRecorder | null = null;
  try {
    await context.resume();
    recorder = createVoiceRecorder(destination.stream);
    const activeRecorder = recorder;
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      const deadline = window.setTimeout(() => reject(new Error("Encoding timed out")), 10_000);
      activeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      activeRecorder.onerror = () => { window.clearTimeout(deadline); reject(new Error("Encoding failed")); };
      activeRecorder.onstop = () => { window.clearTimeout(deadline); resolve(new Blob(chunks, {type: activeRecorder.mimeType})); };
      oscillator.start();
      activeRecorder.start();
      window.setTimeout(() => { if (activeRecorder.state === "recording") activeRecorder.stop(); }, 1_200);
    });
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = decoded.getChannelData(0);
    const audible = samples.some(value => Math.abs(value) > 0.01);
    return {bytes: blob.size, mime: blob.type, seconds: decoded.duration, channels: decoded.numberOfChannels, audible};
  } finally {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    oscillator.disconnect();
    gain.disconnect();
    destination.stream.getTracks().forEach(track => track.stop());
    await context.close();
  }
}

window.__voiceEncoding = {recordSample};
declare global { interface Window { __voiceEncoding: {recordSample: typeof recordSample} } }
