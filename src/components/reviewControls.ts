import type { Answer } from "../scheduler/types";
import { playClickSoundBasic, playClickSoundMelodic } from "../utils/sound";

type ReviewAction = "reveal" | Answer;

export type ReviewIntervals = { again: string; hard: string; good: string; easy: string };

type ReviewControl = {
  action: ReviewAction;
  hotkeys: string[];
  interval?: keyof ReviewIntervals;
  fallbackInterval?: string;
  label: string;
  variant: "primary" | "secondary";
};

const reviewControls: ReviewControl[] = [
  {
    action: "reveal",
    hotkeys: [" ", "Enter"],
    label: "Reveal",
    variant: "primary",
  },
  {
    action: "again",
    hotkeys: ["a", "1"],
    interval: "again",
    fallbackInterval: "<1m",
    label: "Again",
    variant: "secondary",
  },
  {
    action: "hard",
    hotkeys: ["h", "2"],
    interval: "hard",
    fallbackInterval: "<6m",
    label: "Hard",
    variant: "secondary",
  },
  {
    action: "good",
    hotkeys: ["g", " ", "3"],
    interval: "good",
    fallbackInterval: "<10m",
    label: "Good",
    variant: "primary",
  },
  {
    action: "easy",
    hotkeys: ["e", "4"],
    interval: "easy",
    fallbackInterval: "<5d",
    label: "Easy",
    variant: "secondary",
  },
];

export function getReviewControls(activeSide: "front" | "back") {
  return activeSide === "front"
    ? reviewControls.filter((control) => control.action === "reveal")
    : reviewControls.filter((control) => control.action !== "reveal");
}

export function triggerReviewControl(
  action: ReviewAction,
  handlers: {
    chooseAnswer: (answer: Answer) => void;
    reveal: () => void;
  },
) {
  if (action === "reveal") {
    playClickSoundBasic();
    handlers.reveal();
    return;
  }

  playClickSoundMelodic();
  handlers.chooseAnswer(action);
}

export function findReviewControl(activeSide: "front" | "back", key: string) {
  return getReviewControls(activeSide).find((control) => control.hotkeys.includes(key));
}
