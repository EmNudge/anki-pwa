import { soundEffectsEnabledSig } from "../stores";

type Sound = "click_01.mp3" | "click_02.mp3";

function playSound(filename: Sound) {
  if (!soundEffectsEnabledSig.value) return;

  try {
    const audio = new Audio(`/${filename}`);
    audio.volume = 0.5;
    audio.play().catch(console.error);
  } catch (error) {
    console.error("Error playing sound:", error);
  }
}

export function playClickSoundMelodic() {
  playSound("click_01.mp3");
}

export function playClickSoundBasic() {
  playSound("click_02.mp3");
}
