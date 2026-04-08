import { computed, markRaw, type Component } from "vue";
import type { AnkiData } from "../ankiParser";
import {
  ankiDataSig,
  type AppView,
  activeViewSig,
  reviewModeSig,
  soundEffectsEnabledSig,
  toggleSoundEffects,
  schedulerSettingsModalOpenSig,
  resetScheduler,
  currentReviewCardSig,
  reviewQueueSig,
  buryCurrentCard,
  suspendCurrentCard,
  flagCurrentCard,
  markCurrentNote,
} from "../stores";
import type { Command } from "../commandPaletteStore";
import {
  Moon,
  Volume2,
  VolumeX,
  Settings,
  RefreshCw,
  EyeOff,
  Ban,
  Flag,
  Info,
  Star,
  BookOpen,
  Search,
  FolderPlus,
  RefreshCcw,
} from "lucide-vue-next";
import { useTheme } from "../design-system/hooks/useTheme";

function icon(comp: Component): Component {
  return markRaw(comp);
}

const TAB_DEFINITIONS: { id: AppView; title: string; description: string; icon: Component }[] = [
  { id: "review", title: "Review", description: "Study cards with spaced repetition", icon: markRaw(BookOpen) },
  { id: "browse", title: "Browse", description: "Search and explore your cards", icon: markRaw(Search) },
  { id: "create", title: "Create Deck", description: "Build a new deck from scratch", icon: markRaw(FolderPlus) },
  { id: "sync", title: "Sync", description: "Sync with AnkiWeb or import collections", icon: markRaw(RefreshCcw) },
];

export function useCommands() {
  return computed<Command[]>(() => {
    const ankiData = ankiDataSig.value;
    const currentView = activeViewSig.value;

    const tabCommands: Command[] = TAB_DEFINITIONS
      .filter((tab) => tab.id !== currentView)
      .map((tab) => ({
        id: `go-to-${tab.id}`,
        title: `Go to ${tab.title}`,
        description: tab.description,
        icon: tab.icon,
        handler: () => {
          if (tab.id === "review" && activeViewSig.value === "review") {
            reviewModeSig.value = "deck-list";
          } else {
            activeViewSig.value = tab.id;
          }
        },
      }));

    const commands: Command[] = [
      ...tabCommands,
      {
        id: "toggle-theme",
        title: "Toggle Theme",
        description: "Switch between light and dark mode",
        icon: icon(Moon),
        hotkey: "ctrl+T",
        handler: () => {
          const { toggleTheme } = useTheme();
          toggleTheme();
        },
      },
      {
        id: "toggle-sound-effects",
        title: `${soundEffectsEnabledSig.value ? "Disable" : "Enable"} Sound Effects`,
        description: "Toggle audio feedback for card reviews",
        icon: icon(soundEffectsEnabledSig.value ? Volume2 : VolumeX),
        hotkey: "ctrl+E",
        handler: () => {
          toggleSoundEffects();
        },
      },
      {
        id: "scheduler-settings",
        title: "Scheduler Settings",
        description: "Configure spaced repetition algorithm parameters",
        icon: icon(Settings),
        hotkey: "ctrl+,",
        handler: () => {
          schedulerSettingsModalOpenSig.value = true;
        },
      },
      {
        id: "reset-scheduler",
        title: "Reset Scheduler",
        description: "Clear all review history and start fresh",
        icon: icon(RefreshCw),
        handler: () => {
          resetScheduler();
        },
      },
      ...buildCardActionCommands(ankiData),
    ];

    return commands;
  });
}

const FLAG_COLORS: { flag: number; label: string; color: string }[] = [
  { flag: 1, label: "Red", color: "#ff6b6b" },
  { flag: 2, label: "Orange", color: "#ffa94d" },
  { flag: 3, label: "Green", color: "#69db7c" },
  { flag: 4, label: "Blue", color: "#74c0fc" },
  { flag: 5, label: "Pink", color: "#f783ac" },
  { flag: 6, label: "Turquoise", color: "#63e6be" },
  { flag: 7, label: "Purple", color: "#b197fc" },
];

function buildCardActionCommands(ankiData: AnkiData | null): Command[] {
  const reviewCard = currentReviewCardSig.value;
  if (!reviewCard || activeViewSig.value !== "review" || reviewModeSig.value !== "studying") return [];

  const queue = reviewQueueSig.value;
  const noteCard = ankiData?.cards[reviewCard.cardIndex];
  const currentFlag = reviewCard.reviewState.flags ?? 0;
  const isMarked = noteCard?.tags.some((t) => t.toLowerCase() === "marked") ?? false;

  const commands: Command[] = [
    {
      id: "bury-card",
      title: "Bury Card",
      description: "Hide this card until tomorrow's review session",
      icon: icon(EyeOff),
      hotkey: "-",
      handler: () => { buryCurrentCard(); },
    },
    {
      id: "suspend-card",
      title: "Suspend Card",
      description: "Remove this card from all future reviews until manually unsuspended",
      icon: icon(Ban),
      hotkey: "@",
      handler: () => { suspendCurrentCard(); },
    },
    {
      id: "flag-card",
      title: "Flag Card",
      description: "Mark this card with a colored flag for later reference",
      icon: icon(Flag),
      label: currentFlag > 0 ? `Flag ${currentFlag}` : undefined,
      children: [
        {
          id: "flag-none",
          title: "No Flag",
          icon: icon(Flag),
          label: currentFlag === 0 ? "Current" : undefined,
          handler: () => { flagCurrentCard(0); },
        },
        ...FLAG_COLORS.map(({ flag, label, color }) => ({
          id: `flag-${flag}`,
          title: `${label} Flag`,
          icon: icon(Flag),
          label: currentFlag === flag ? "Current" : undefined,
          metadata: [{ label: "Color", value: color }],
          handler: () => { flagCurrentCard(flag); },
        })),
      ],
    },
    {
      id: "card-info",
      title: "Card Info",
      description: "View scheduling stats, ease factor, and review history",
      icon: icon(Info),
      hotkey: "I",
      metadata: buildCardInfoMetadata(reviewCard, queue),
      handler: () => ({ keepOpen: true }),
    },
  ];

  if (noteCard) {
    commands.push({
      id: "mark-note",
      title: isMarked ? "Unmark Note" : "Mark Note",
      description: isMarked ? "Remove the \"marked\" tag from this note" : "Tag this note as \"marked\" for easy filtering",
      icon: icon(Star),
      hotkey: "*",
      label: isMarked ? "Marked" : undefined,
      handler: () => { markCurrentNote(); },
    });
  }

  return commands;
}

function buildCardInfoMetadata(
  reviewCard: import("../scheduler/queue").ReviewCard,
  queue: import("../scheduler/queue").ReviewQueue | null,
): Command["metadata"] {
  const displayInfo = queue?.getCardDisplayInfo(reviewCard) ?? {};
  const entries: { label: string; value: string }[] = [
    { label: "Card ID", value: reviewCard.cardId },
    { label: "New", value: reviewCard.isNew ? "Yes" : "No" },
  ];

  if (displayInfo.ease !== undefined) {
    entries.push({ label: "Ease Factor", value: String(Math.round((displayInfo.ease as number) * 100)) + "%" });
  }
  if (displayInfo.interval !== undefined) {
    entries.push({ label: "Interval", value: displayInfo.interval + " days" });
  }
  if (displayInfo.repetitions !== undefined) {
    entries.push({ label: "Repetitions", value: String(displayInfo.repetitions) });
  }
  if (displayInfo.stability !== undefined) {
    entries.push({ label: "Stability", value: String(displayInfo.stability) });
  }
  if (displayInfo.difficulty !== undefined) {
    entries.push({ label: "Difficulty", value: String(displayInfo.difficulty) });
  }

  const flags = reviewCard.reviewState.flags ?? 0;
  if (flags > 0) {
    const flagInfo = FLAG_COLORS.find((f) => f.flag === flags);
    entries.push({ label: "Flag", value: flagInfo ? flagInfo.label : String(flags) });
  }

  if (reviewCard.reviewState.lastReviewed) {
    entries.push({ label: "Last Reviewed", value: new Date(reviewCard.reviewState.lastReviewed).toLocaleDateString() });
  }

  return entries;
}
