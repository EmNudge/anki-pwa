import type { SubDeckInfo } from "../types";
import type { AnkiDB2Data } from "../ankiParser/anki2";
import type { AnkiDB21bData } from "../ankiParser/anki21b";

type AnkiData = {
  files: Map<string, string>;
  cards: AnkiDB2Data["cards"] | AnkiDB21bData["cards"];
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
};

export function computeDeckInfo(ankiData: AnkiData) {
  const cardsWithDeckIds = ankiData.cards.map((card) => {
    const deckEntry = Object.entries(ankiData.decks).find(
      ([_, deck]) => deck.name === card.deckName,
    );
    return { card, deckId: deckEntry?.[0] };
  });

  const cardsByDeckId = Object.groupBy(cardsWithDeckIds, (item) => item.deckId ?? "unknown");

  const subdecks: SubDeckInfo[] = Object.entries(ankiData.decks)
    .map(([deckId, deck]) => {
      const cardsInDeck = cardsByDeckId[deckId] ?? [];
      const templateNames = new Set(
        cardsInDeck.flatMap((item) => item.card.templates.map((t) => t.name)),
      );

      // Extract just the last segment after the final "::" for display
      const displayName = deck.name.includes("::") ? deck.name.split("::").pop()! : deck.name;

      return {
        id: deckId,
        name: displayName,
        cardCount: cardsInDeck.length,
        templateCount: templateNames.size,
      };
    })
    .filter((subdeck) => subdeck.cardCount > 0);

  const uniqueTemplates = new Set(
    ankiData.cards.flatMap((card) => card.templates.map((template) => template.name)),
  );

  const displayName = getDisplayName(ankiData.deckName, subdecks);

  return {
    name: displayName,
    cardCount: ankiData.cards.length,
    templateCount: uniqueTemplates.size,
    subdecks,
  };
}

function getDisplayName(deckName: string, subdecks: SubDeckInfo[]) {
  if (deckName !== "Default" || subdecks.length === 0) {
    return deckName;
  }

  const parentNames = subdecks
    .map((subdeck) => {
      const parts = subdeck.name.split("::");
      return parts.length > 1 ? parts[0] : null;
    })
    .filter((name): name is string => name !== null);

  const allSameParent =
    parentNames.length > 0 && parentNames.every((name) => name === parentNames[0]);

  return allSameParent ? parentNames[0]! : deckName;
}
