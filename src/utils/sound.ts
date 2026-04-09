import { soundEffectsEnabledSig } from "../stores";
import { isTruthy } from "./assert";

type Sound = "click_01.mp3" | "click_02.mp3";

function playAudioSource(src: string, volume = 1): void {
  try {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch(console.error);
  } catch (error) {
    console.error("Error playing sound:", error);
  }
}

function playSound(filename: Sound): void {
  if (!soundEffectsEnabledSig.value) return;
  playAudioSource(`/${filename}`, 0.5);
}

export function getAutoplayAudioSources(html: string): string[] {
  const allAudioContainers = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelectorAll<HTMLAudioElement>("div.audio-container[data-autoplay] audio");
  return [...allAudioContainers]
    .map((audio) => audio.getAttribute("src"))
    .filter(isTruthy);
}

export function playAudio(src: string): void {
  playAudioSource(src);
}

export function playClickSoundMelodic(): void {
  playSound("click_01.mp3");
}

export function playClickSoundBasic(): void {
  playSound("click_02.mp3");
}
