import { computed, h, markRaw, type Component, type VNode } from "vue";
import {
  ankiCachePromise,
  blobSig,
  ankiDataSig,
  schedulerEnabledSig,
  soundEffectsEnabledSig,
  toggleScheduler,
  toggleSoundEffects,
  schedulerSettingsModalOpenSig,
  resetScheduler,
  deckInfoSig,
  selectedDeckIdSig,
  selectedCardSig,
  mediaFilesSig,
  cardsSig,
} from "../stores";
import type { Command } from "../commandPaletteStore";
import {
  Folder,
  ArrowRight,
  Layers,
  Moon,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Settings,
  RefreshCw,
  ClipboardList,
  FileText,
  Grid3x3,
  Hash,
} from "lucide-vue-next";
import { useTheme } from "../design-system/hooks/useTheme";
import { getRenderedCardString } from "../utils/render";

function icon(comp: Component): Component {
  return markRaw(comp);
}

function metadataHtml(html: string): VNode {
  return h("div", { innerHTML: html, style: "white-space: pre-wrap; word-break: break-word" });
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
      h("div", { class: "card-preview-content", innerHTML: cardHtml }),
    ]),
  ]);
}

function getCardTextPreview(card: { values: Record<string, string | null> }, maxLen: number): string {
  const firstFieldValue = Object.values(card.values)[0];
  const raw = typeof firstFieldValue === "string" ? firstFieldValue : "";
  const text = raw.replace(/<[^>]*>/g, "").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function renderFirstCardPreview(
  cards: { values: Record<string, string | null>; templates: { qfmt: string }[] }[],
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
              await ankiCachePromise.then((cache) => cache.put("anki-deck", new Response(file)));
              blobSig.value = file;
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
          selectedCardSig.value = selectedCardSig.value + 1;
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
                    ...Object.entries(card.values).map(([fieldName, fieldValue]) => ({
                      label: fieldName,
                      value: metadataHtml(fieldValue ?? ""),
                    })),
                    ...(card.deckName ? [{ label: "Deck", value: card.deckName }] : []),
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
        id: "toggle-scheduler",
        title: `${schedulerEnabledSig.value ? "Disable" : "Enable"} Scheduler`,
        icon: icon(schedulerEnabledSig.value ? Pause : Play),
        hotkey: "ctrl+R",
        handler: () => {
          toggleScheduler();
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
                {
                  id: "all",
                  title: "All Cards",
                  icon: icon(Layers),
                  label: selectedDeckId === null ? "Currently selected" : undefined,
                  metadata: (() => {
                    const allTemplateNames = Array.from(
                      new Set(ankiData.cards.flatMap((c) => c.templates.map((t) => t.name))),
                    );
                    const preview = renderFirstCardPreview(ankiData.cards, mediaFilesSig.value);
                    return [
                      { label: "Cards", value: deckInfo.cardCount.toString() },
                      { label: "Templates", value: allTemplateNames.join(", ") },
                      ...(preview ? [{ label: "Example Card", value: preview }] : []),
                    ];
                  })(),
                  handler: () => {
                    selectedDeckIdSig.value = null;
                  },
                },
                ...deckInfo.subdecks.map((subdeck) => {
                  const subdeckCards = ankiData.cards.filter((c) => {
                    const deck = ankiData.decks[subdeck.id];
                    return deck && c.deckName === deck.name;
                  });
                  const templateNames = Array.from(
                    new Set(subdeckCards.flatMap((c) => c.templates.map((t) => t.name))),
                  );
                  const preview = renderFirstCardPreview(subdeckCards, mediaFilesSig.value);
                  return {
                    id: subdeck.id,
                    title: subdeck.name,
                    icon: icon(Layers),
                    label: selectedDeckId === subdeck.id ? "Currently selected" : undefined,
                    metadata: [
                      { label: "Cards", value: subdeck.cardCount.toString() },
                      { label: "Templates", value: templateNames.join(", ") || "None" },
                      ...(preview ? [{ label: "Example Card", value: preview }] : []),
                    ],
                    handler: () => {
                      selectedDeckIdSig.value = subdeck.id;
                    },
                  };
                }),
              ],
            },
          ]
        : []),
      ...(ankiData
        ? [
            {
              id: "browse-notes",
              title: "Browse All Notes",
              icon: icon(Layers),
              children: ankiData.cards.map((card, index) => {
                const previewText = getCardTextPreview(card, 30);
                const title = previewText ? `Note ${index + 1}: ${previewText}` : `Note ${index + 1}`;
                const label =
                  currentDeckName && card.deckName === currentDeckName
                    ? "In current deck"
                    : undefined;
                const metadata = [
                  ...Object.entries(card.values).map(([fieldName, fieldValue]) => ({
                    label: fieldName,
                    value: metadataHtml(fieldValue ?? ""),
                  })),
                  ...(card.deckName ? [{ label: "Deck", value: card.deckName }] : []),
                  {
                    label: `Templates ${card.templates.length}`,
                    value: card.templates.map((t) => t.name).join(", "),
                  },
                ];
                return {
                  id: `Note ${index + 1}`,
                  title,
                  icon: icon(Layers),
                  label,
                  metadata,
                  handler: () => {
                    return { keepOpen: true };
                  },
                } satisfies Command;
              }),
            },
            ...(() => {
              const allTemplates = ankiData.cards.flatMap((c) => c.templates) ?? [];
              const uniqueTemplates = Array.from(
                new Map(allTemplates.map((t) => [t.name, t] as const)).values(),
              );
              const currentDeckTemplateNames = new Set(
                (currentDeckName
                  ? ankiData.cards.filter((c) => c.deckName === currentDeckName)
                  : []
                ).flatMap((c) => c.templates.map((t) => t.name)),
              );

              const items: Command[] = [
                {
                  id: "browse-templates",
                  title: "Browse All Templates",
                  icon: icon(ClipboardList),
                  hotkey: "ctrl+L",
                  children: uniqueTemplates.map((t) => ({
                    id: `AllTpl:${t.name}`,
                    title: t.name,
                    icon: icon(FileText),
                    label:
                      currentDeckName && currentDeckTemplateNames.has(t.name)
                        ? "In current deck"
                        : undefined,
                    metadata: [
                      { label: "Template Front", value: templateViewer(t.qfmt) },
                      { label: "Template Back", value: templateViewer(t.afmt) },
                    ],
                  })),
                },
              ];
              return items;
            })(),
          ]
        : []),
    ];

    return commands;
  });
}
