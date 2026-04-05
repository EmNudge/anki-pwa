import { soundEffectsEnabledSig } from "../stores";
import { isTruthy } from "./assert";

type Sound = "click_01.mp3" | "click_02.mp3";

function playAudioSource(src: string, volume = 1) {
  try {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch(console.error);
  } catch (error) {
    console.error("Error playing sound:", error);
  }
}

function playSound(filename: Sound) {
  if (!soundEffectsEnabledSig.value) return;
  playAudioSource(`/${filename}`, 0.5);
}

export function getAutoplayAudioSources(html: string): string[] {
  const allAudioContainers = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelectorAll<HTMLAudioElement>("div.audio-container[data-autoplay] audio");
  return [...allAudioContainers].map((audio) => audio.src).filter(isTruthy);
}

export function playAudio(src: string) {
  playAudioSource(src);
}

export function playClickSoundMelodic() {
  playSound("click_01.mp3");
}

export function playClickSoundBasic() {
  playSound("click_02.mp3");
}
