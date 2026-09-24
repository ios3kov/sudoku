import { preparePhoto } from "../../../features/messenger/photo-preparation";

async function sample(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 3200;
  canvas.height = 1600;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 3200, 1600);
  gradient.addColorStop(0, "red");
  gradient.addColorStop(1, "blue");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 3200, 1600);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/jpeg", 1));
  canvas.width = canvas.height = 0;
  return new File([blob], "photo.jpg", {type: "image/jpeg"});
}

window.__photos = {preparePhoto, sample};
declare global {
  interface Window { __photos: {preparePhoto: typeof preparePhoto; sample: typeof sample; resumeDecode?: () => void; decodeStarted?: boolean} }
}
