import { soundEffectsEnabledSig } from "../stores";

type Sound = "click_01.mp3" | "click_02.mp3";

function playSound(filename: Sound) {
  try {
    const audio = new Audio(`/${filename}`);
    audio.volume = 0.5;
    audio.play().catch(console.error);
  } catch (error) {
    console.error("Error playing sound:", error);
  }
}

export function playClickSoundMelodic() {
  if (!soundEffectsEnabledSig.value) {
    return;
  }

  playSound("click_01.mp3");
}

export function playClickSoundBasic() {
  if (!soundEffectsEnabledSig.value) {
    return;
  }

  playSound("click_02.mp3");
}
