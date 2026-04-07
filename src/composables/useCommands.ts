import { computed, h, markRaw, type Component, type VNode } from "vue";
import type { AnkiData } from "../ankiParser";
import {
  ankiDataSig,
  schedulerEnabledSig,
  soundEffectsEnabledSig,
  toggleSoundEffects,
  schedulerSettingsModalOpenSig,
  resetScheduler,
  deckInfoSig,
  selectedDeckIdSig,
  selectedCardSig,
  mediaFilesSig,
  cardsSig,
  addCachedFile,
  moveToNextCard,
  currentReviewCardSig,
  reviewQueueSig,
  buryCurrentCard,
  suspendCurrentCard,
  flagCurrentCard,
  markCurrentNote,
} from "../stores";
import type { Command } from "../commandPaletteStore";
import {
  Folder,
  ArrowRight,
  Layers,
  Moon,
  Volume2,
  VolumeX,
  Settings,
  RefreshCw,
  ClipboardList,
  FileText,
  Grid3x3,
  Hash,
  EyeOff,
  Ban,
  Flag,
  Info,
  Star,
} from "lucide-vue-next";
import { useTheme } from "../design-system/hooks/useTheme";
import { getRenderedCardString } from "../utils/render";
import { sanitizeHtmlForPreview } from "../utils/sanitize";

type CommandCard = {
  deckName: string;
  templates: { name: string; afmt: string; qfmt: string }[];
  values: Record<string, string | null>;
};

function icon(comp: Component): Component {
  return markRaw(comp);
}

function metadataHtml(html: string): VNode {
  return h("div", {
    innerHTML: sanitizeHtmlForPreview(html),
    style: "white-space: pre-wrap; word-break: break-word",
  });
}

function templateViewer(templateHtml: string): VNode {
  const segments = templateHtml.split(/(\{\{[^}]+\}\})/g);
  const children = segments
    .map((seg, i) => (i % 2 === 1 ? h("span", { class: "template-variable" }, seg) : seg))
    .filter(Boolean);
  return h("div", { class: "metadata-value-code" }, children);
}

function cardPreview(cardHtml: string): VNode {
  return h("div", { class: "card-preview-container" }, [
    h("div", { class: "card-preview" }, [
      h("div", { class: "card-preview-badge" }, "Front"),
      h("div", { class: "card-preview-content", innerHTML: sanitizeHtmlForPreview(cardHtml) }),
    ]),
  ]);
}

function getCardTextPreview(
  card: { values: Record<string, string | null> },
  maxLen: number,
): string {
  const firstFieldValue = Object.values(card.values)[0];
  const raw = typeof firstFieldValue === "string" ? firstFieldValue : "";
  const text = raw.replace(/<[^>]*>/g, "").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function renderFirstCardPreview(
  cards: readonly { values: Record<string, string | null>; templates: { qfmt: string }[] }[],
  mediaFiles: Map<string, string>,
): VNode | null {
  const firstCard = cards[0];
  if (!firstCard || firstCard.templates.length === 0) return null;
  const firstTemplate = firstCard.templates[0];
  if (!firstTemplate) return null;
  const renderedFront = getRenderedCardString({
    templateString: firstTemplate.qfmt,
    variables: firstCard.values,
    mediaFiles,
  });
  return cardPreview(renderedFront);
}

function getCardMetadata(card: CommandCard) {
  return [
    ...Object.entries(card.values).map(([fieldName, fieldValue]) => ({
      label: fieldName,
      value: metadataHtml(fieldValue ?? ""),
    })),
    ...(card.deckName ? [{ label: "Deck", value: card.deckName }] : []),
  ];
}

function getUniqueTemplateNames(cards: readonly CommandCard[]): string[] {
  return Array.from(new Set(cards.flatMap((card) => card.templates.map((template) => template.name))));
}

function buildDeckCommand({
  cardCount,
  cards,
  id,
  isSelected,
  mediaFiles,
  title,
  onSelect,
}: {
  cardCount: number;
  cards: readonly CommandCard[];
  id: string;
  isSelected: boolean;
  mediaFiles: Map<string, string>;
  onSelect: () => void;
  title: string;
}): Command {
  const preview = renderFirstCardPreview(cards, mediaFiles);

  return {
    id,
    title,
    icon: icon(Layers),
    label: isSelected ? "Currently selected" : undefined,
    metadata: [
      { label: "Cards", value: cardCount.toString() },
      { label: "Templates", value: getUniqueTemplateNames(cards).join(", ") || "None" },
      ...(preview ? [{ label: "Example Card", value: preview }] : []),
    ],
    handler: onSelect,
  };
}

function buildBrowseNotesCommand(ankiData: AnkiData, currentDeckName: string | null): Command {
  return {
    id: "browse-notes",
    title: "Browse All Notes",
    icon: icon(Layers),
    children: ankiData.cards.map((card, index) => {
      const previewText = getCardTextPreview(card, 30);
      const title = previewText ? `Note ${index + 1}: ${previewText}` : `Note ${index + 1}`;
      const label =
        currentDeckName && card.deckName === currentDeckName ? "In current deck" : undefined;

      return {
        id: `Note ${index + 1}`,
        title,
        icon: icon(Layers),
        label,
        metadata: [
          ...getCardMetadata(card),
          {
            label: `Templates ${card.templates.length}`,
            value: card.templates.map((template) => template.name).join(", "),
          },
        ],
        handler: () => {
          return { keepOpen: true };
        },
      } satisfies Command;
    }),
  };
}

function buildBrowseTemplatesCommand(ankiData: AnkiData, currentDeckName: string | null): Command {
  const uniqueTemplates = Array.from(
    new Map(ankiData.cards.flatMap((card) => card.templates).map((template) => [template.name, template] as const)).values(),
  );
  const currentDeckTemplateNames = new Set(
    (currentDeckName
      ? ankiData.cards.filter((card) => card.deckName === currentDeckName)
      : []
    ).flatMap((card) => card.templates.map((template) => template.name)),
  );

  return {
    id: "browse-templates",
    title: "Browse All Templates",
    icon: icon(ClipboardList),
    hotkey: "ctrl+L",
    children: uniqueTemplates.map((template) => ({
      id: `AllTpl:${template.name}`,
      title: template.name,
      icon: icon(FileText),
      label:
        currentDeckName && currentDeckTemplateNames.has(template.name)
          ? "In current deck"
          : undefined,
      metadata: [
        { label: "Template Front", value: templateViewer(template.qfmt) },
        { label: "Template Back", value: templateViewer(template.afmt) },
      ],
    })),
  };
}

export function useCommands() {
  return computed<Command[]>(() => {
    const deckInfo = deckInfoSig.value;
    const ankiData = ankiDataSig.value;
    const selectedDeckId = selectedDeckIdSig.value;
    const currentDeckName = (() => {
      if (!ankiData || !selectedDeckId) return null;
      const deck = ankiData.decks[selectedDeckId];
      return deck ? deck.name : null;
    })();

    const commands: Command[] = [
      {
        id: "upload-file",
        title: "Upload Anki Deck",
        icon: icon(Folder),
        hotkey: "ctrl+N",
        handler: () => {
          const inputEl = document.createElement("input");
          inputEl.type = "file";
          inputEl.addEventListener("change", async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              await addCachedFile(file);
            }
          });
          inputEl.click();
        },
      },
      {
        id: "next-card",
        title: "Next Card",
        icon: icon(ArrowRight),
        hotkey: ">",
        handler: () => {
          moveToNextCard();
        },
      },
      ...(!schedulerEnabledSig.value && ankiData && cardsSig.value.length > 0
        ? [
            {
              id: "jump-to-card",
              title: "Jump to Card",
              icon: icon(Hash),
              hotkey: "ctrl+J",
              children: cardsSig.value.map((card, index) => {
                const preview = getCardTextPreview(card, 40);
                const title = preview ? `Card ${index + 1}: ${preview}` : `Card ${index + 1}`;
                const isCurrentCard = selectedCardSig.value === index;

                return {
                  id: `jump-card-${index}`,
                  title,
                  icon: icon(Hash),
                  label: isCurrentCard ? "Currently viewing" : undefined,
                  metadata: [
                    { label: "Card Number", value: (index + 1).toString() },
                    ...getCardMetadata(card),
                  ],
                  handler: () => {
                    selectedCardSig.value = index;
                  },
                } satisfies Command;
              }),
            },
          ]
        : []),
      {
        id: "toggle-theme",
        title: "Toggle Theme",
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
        icon: icon(soundEffectsEnabledSig.value ? Volume2 : VolumeX),
        hotkey: "ctrl+E",
        handler: () => {
          toggleSoundEffects();
        },
      },
      {
        id: "scheduler-settings",
        title: "Scheduler Settings",
        icon: icon(Settings),
        hotkey: "ctrl+,",
        handler: () => {
          schedulerSettingsModalOpenSig.value = true;
        },
      },
      {
        id: "reset-scheduler",
        title: "Reset Scheduler",
        icon: icon(RefreshCw),
        handler: () => {
          resetScheduler();
        },
      },
      ...(deckInfo && deckInfo.subdecks.length > 0 && ankiData
        ? [
            {
              id: "switch-deck",
              title: "Switch Deck",
              icon: icon(Grid3x3),
              hotkey: "ctrl+D",
              children: [
                buildDeckCommand({
                  id: "all",
                  title: "All Cards",
                  cards: ankiData.cards,
                  cardCount: deckInfo.cardCount,
                  isSelected: selectedDeckId === null,
                  mediaFiles: mediaFilesSig.value,
                  onSelect: () => {
                    selectedDeckIdSig.value = null;
                  },
                }),
                ...deckInfo.subdecks.map((subdeck) => {
                  const subdeckCards = ankiData.cards.filter((c) => {
                    const deck = ankiData.decks[subdeck.id];
                    return deck && c.deckName === deck.name;
                  });
                  return buildDeckCommand({
                    id: subdeck.id,
                    title: subdeck.name,
                    cards: subdeckCards,
                    cardCount: subdeck.cardCount,
                    isSelected: selectedDeckId === subdeck.id,
                    mediaFiles: mediaFilesSig.value,
                    onSelect: () => {
                      selectedDeckIdSig.value = subdeck.id;
                    },
                  });
                }),
              ],
            },
          ]
        : []),
      ...(ankiData
        ? [
            buildBrowseNotesCommand(ankiData, currentDeckName),
            buildBrowseTemplatesCommand(ankiData, currentDeckName),
          ]
        : []),
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
  if (!reviewCard) return [];

  const queue = reviewQueueSig.value;
  const noteCard = ankiData?.cards[reviewCard.cardIndex];
  const currentFlag = reviewCard.reviewState.flags ?? 0;
  const isMarked = noteCard?.tags.some((t) => t.toLowerCase() === "marked") ?? false;

  const commands: Command[] = [
    {
      id: "bury-card",
      title: "Bury Card",
      icon: icon(EyeOff),
      hotkey: "-",
      handler: () => { buryCurrentCard(); },
    },
    {
      id: "suspend-card",
      title: "Suspend Card",
      icon: icon(Ban),
      hotkey: "@",
      handler: () => { suspendCurrentCard(); },
    },
    {
      id: "flag-card",
      title: "Flag Card",
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
