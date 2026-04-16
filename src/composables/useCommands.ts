import { computed, markRaw, h, type Component } from "vue";
import type { AnkiData } from "../ankiParser";
import {
  ankiDataSig,
  type AppView,
  activeViewSig,
  reviewModeSig,
  soundEffectsEnabledSig,
  toggleSoundEffects,
  schedulerSettingsModalOpenSig,
  flagSettingsModalOpenSig,
  notetypeManagerOpenSig,
  resetScheduler,
  currentReviewCardSig,
  reviewQueueSig,
  buryCurrentCard,
  suspendCurrentCard,
  flagCurrentCard,
  markCurrentNote,
  buryCurrentNote,
  deleteCurrentNote,
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
  Pencil,
  Play,
  Pause,
  Trash2,
  Keyboard,
  Undo2,
  Redo2,
  Copy,
  Layers,
} from "lucide-vue-next";
import { useTheme } from "../design-system/hooks/useTheme";
import { getFlags, getFlagLabel } from "../lib/flags";
import ReviewLogPanel from "../components/ReviewLogPanel.vue";
import { canUndo, canRedo, undoDescription, redoDescription } from "../undoRedo";
import { executeUndo, executeRedo } from "../undoRedoExecutor";

function icon(comp: Component): Component {
  return markRaw(comp);
}

const TAB_DEFINITIONS: { id: AppView; title: string; description: string; icon: Component }[] = [
  {
    id: "review",
    title: "Review",
    description: "Study cards with spaced repetition",
    icon: markRaw(BookOpen),
  },
  {
    id: "browse",
    title: "Browse",
    description: "Search and explore your cards",
    icon: markRaw(Search),
  },
  {
    id: "create",
    title: "Create Deck",
    description: "Build a new deck from scratch",
    icon: markRaw(FolderPlus),
  },
  {
    id: "sync",
    title: "Sync",
    description: "Sync with AnkiWeb or import collections",
    icon: markRaw(RefreshCcw),
  },
];

interface UseCommandsOptions {
  onEditCard?: () => void;
  onReplayAudio?: () => void;
  onPauseAudio?: () => void;
  onShowShortcuts?: () => void;
  onUndoToast?: (message: string) => void;
}

export function useCommands(options: UseCommandsOptions = {}) {
  return computed<Command[]>(() => {
    const ankiData = ankiDataSig.value;
    const currentView = activeViewSig.value;

    const tabCommands: Command[] = TAB_DEFINITIONS.filter((tab) => tab.id !== currentView).map(
      (tab) => ({
        id: `go-to-${tab.id}`,
        title: `Go to ${tab.title}`,
        description: tab.description,
        icon: tab.icon,
        group: "Navigation",
        handler: () => {
          if (tab.id === "review" && activeViewSig.value === "review") {
            reviewModeSig.value = "deck-list";
          } else {
            activeViewSig.value = tab.id;
          }
        },
      }),
    );

    // Undo/redo commands (only show when available)
    const undoRedoCommands: Command[] = [];
    if (canUndo.value) {
      undoRedoCommands.push({
        id: "undo",
        title: `Undo: ${undoDescription.value}`,
        description: "Revert the last operation",
        icon: icon(Undo2),
        hotkey: "ctrl+Z",
        group: "Edit",
        handler: () => {
          void executeUndo().then((desc) => {
            if (desc) options.onUndoToast?.(`Undo: ${desc}`);
          });
        },
      });
    }
    if (canRedo.value) {
      undoRedoCommands.push({
        id: "redo",
        title: `Redo: ${redoDescription.value}`,
        description: "Re-apply the last undone operation",
        icon: icon(Redo2),
        hotkey: "ctrl+shift+Z",
        group: "Edit",
        handler: () => {
          void executeRedo().then((desc) => {
            if (desc) options.onUndoToast?.(`Redo: ${desc}`);
          });
        },
      });
    }

    const commands: Command[] = [
      ...undoRedoCommands,
      ...buildCardActionCommands(ankiData, options),
      ...tabCommands,
      {
        id: "toggle-theme",
        title: "Toggle Theme",
        description: "Switch between light and dark mode",
        icon: icon(Moon),
        hotkey: "ctrl+T",
        group: "Settings",
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
        group: "Settings",
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
        group: "Settings",
        handler: () => {
          schedulerSettingsModalOpenSig.value = true;
        },
      },
      {
        id: "flag-settings",
        title: "Customize Flags",
        description: "Rename flag labels",
        icon: icon(Flag),
        group: "Settings",
        handler: () => {
          flagSettingsModalOpenSig.value = true;
        },
      },
      {
        id: "reset-scheduler",
        title: "Reset Scheduler",
        description: "Clear all review history and start fresh",
        icon: icon(RefreshCw),
        group: "Settings",
        handler: () => {
          resetScheduler();
        },
      },
      {
        id: "find-duplicates",
        title: "Find Duplicates",
        description: "Detect and manage duplicate notes in your collection",
        icon: icon(Copy),
        group: "Tools",
        handler: () => {
          activeViewSig.value = "duplicates";
        },
      },
      {
        id: "manage-note-types",
        title: "Manage Note Types",
        description: "Create, edit, and manage note type definitions",
        icon: icon(Layers),
        group: "Tools",
        handler: () => {
          notetypeManagerOpenSig.value = true;
        },
      },
      {
        id: "show-shortcuts",
        title: "Keyboard Shortcuts",
        description: "Show all available keyboard shortcuts",
        icon: icon(Keyboard),
        hotkey: "?",
        group: "Help",
        handler: () => {
          options.onShowShortcuts?.();
        },
      },
    ];

    return commands;
  });
}


function buildCardActionCommands(ankiData: AnkiData | null, options: UseCommandsOptions): Command[] {
  const reviewCard = currentReviewCardSig.value;
  if (!reviewCard || activeViewSig.value !== "review" || reviewModeSig.value !== "studying")
    return [];

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
      group: "Current Card",
      handler: () => {
        buryCurrentCard();
      },
    },
    {
      id: "suspend-card",
      title: "Suspend Card",
      description: "Remove this card from all future reviews until manually unsuspended",
      icon: icon(Ban),
      hotkey: "@",
      group: "Current Card",
      handler: () => {
        suspendCurrentCard();
      },
    },
    {
      id: "flag-card",
      title: "Flag Card",
      description: "Mark this card with a colored flag for later reference",
      icon: icon(Flag),
      label: currentFlag > 0 ? getFlagLabel(currentFlag) : undefined,
      group: "Current Card",
      children: [
        {
          id: "flag-none",
          title: "No Flag",
          icon: icon(Flag),
          hotkey: "ctrl+0",
          label: currentFlag === 0 ? "Current" : undefined,
          handler: () => {
            flagCurrentCard(0);
          },
        },
        ...getFlags().map(({ flag, label, color }) => ({
          id: `flag-${flag}`,
          title: `${label} Flag`,
          icon: icon(Flag),
          hotkey: `ctrl+${flag}`,
          label: currentFlag === flag ? "Current" : undefined,
          metadata: [{ label: "Color", value: color }],
          handler: () => {
            flagCurrentCard(flag);
          },
        })),
      ],
    },
    {
      id: "card-info",
      title: "Card Info",
      description: "View scheduling stats, ease factor, and review history",
      icon: icon(Info),
      hotkey: "I",
      group: "Current Card",
      metadata: buildCardInfoMetadata(reviewCard, queue),
      handler: () => ({ keepOpen: true }),
    },
  ];

  if (noteCard) {
    commands.push({
      id: "mark-note",
      title: isMarked ? "Unmark Note" : "Mark Note",
      description: isMarked
        ? 'Remove the "marked" tag from this note'
        : 'Tag this note as "marked" for easy filtering',
      icon: icon(Star),
      hotkey: "*",
      label: isMarked ? "Marked" : undefined,
      group: "Current Card",
      handler: () => {
        markCurrentNote();
      },
    });
  }

  commands.push(
    {
      id: "edit-card",
      title: "Edit Card",
      description: "Open the editor for the current card",
      icon: icon(Pencil),
      group: "Current Card",
      handler: () => {
        options.onEditCard?.();
      },
    },
    {
      id: "bury-note",
      title: "Bury Note",
      description: "Hide all cards of this note until tomorrow",
      icon: icon(EyeOff),
      hotkey: "=",
      group: "Current Card",
      handler: () => {
        buryCurrentNote();
      },
    },
    {
      id: "replay-audio",
      title: "Replay Audio",
      description: "Replay any audio on the current card",
      icon: icon(Play),
      hotkey: "R",
      group: "Current Card",
      handler: () => {
        options.onReplayAudio?.();
      },
    },
    {
      id: "pause-audio",
      title: "Pause/Resume Audio",
      description: "Pause or resume audio playback",
      icon: icon(Pause),
      hotkey: "5",
      group: "Current Card",
      handler: () => {
        options.onPauseAudio?.();
      },
    },
    {
      id: "delete-note",
      title: "Delete Note",
      description: "Permanently delete this note and all its cards",
      icon: icon(Trash2),
      hotkey: "ctrl+Delete",
      group: "Current Card",
      handler: () => {
        if (confirm("Delete this note and all its cards? This cannot be undone.")) {
          deleteCurrentNote();
        }
      },
    },
  );

  return commands;
}

function buildCardInfoMetadata(
  reviewCard: import("../scheduler/queue").ReviewCard,
  queue: import("../scheduler/queue").ReviewQueue | null,
): Command["metadata"] {
  const displayInfo = queue?.getCardDisplayInfo(reviewCard) ?? {};
  const entries: NonNullable<Command["metadata"]> = [
    { label: "Card ID", value: reviewCard.cardId },
    { label: "New", value: reviewCard.isNew ? "Yes" : "No" },
  ];

  if (displayInfo.ease !== undefined) {
    entries.push({
      label: "Ease Factor",
      value: String(Math.round((displayInfo.ease as number) * 100)) + "%",
    });
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
    entries.push({ label: "Flag", value: getFlagLabel(flags) });
  }

  if (reviewCard.reviewState.lastReviewed) {
    entries.push({
      label: "Last Reviewed",
      value: new Date(reviewCard.reviewState.lastReviewed).toLocaleDateString(),
    });
  }

  entries.push({
    label: "Review Log",
    value: h(ReviewLogPanel, { cardId: reviewCard.cardId }),
  });

  return entries;
}
