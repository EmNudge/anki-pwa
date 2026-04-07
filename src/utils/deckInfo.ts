import type { SubDeckInfo, DeckTreeNode } from "../types";
import type { AnkiData } from "../ankiParser";

export function computeDeckInfo(ankiData: AnkiData) {
  const nameToDeckId = new Map(
    Object.entries(ankiData.decks).map(([id, deck]) => [deck.name, id]),
  );

  const cardsWithDeckIds = ankiData.cards.map((card) => ({
    card,
    deckId: nameToDeckId.get(card.deckName),
  }));

  const cardsByDeckId = Object.groupBy(cardsWithDeckIds, (item) => item.deckId ?? "unknown");

  const subdecks: SubDeckInfo[] = Object.entries(ankiData.decks)
    .map(([deckId, deck]) => {
      const cardsInDeck = cardsByDeckId[deckId] ?? [];
      const templateNames = new Set(
        cardsInDeck.flatMap((item) => item.card.templates.map((t) => t.name)),
      );

      // Extract just the last segment after the final "::" for display
      const displayName = deck.name.includes("::") ? deck.name.split("::").pop()! : deck.name;

      // Compute new/learn/due counts from Anki scheduling data
      let newCount = 0;
      let learnCount = 0;
      let dueCount = 0;

      for (const item of cardsInDeck) {
        const sched = item.card.scheduling;
        if (!sched) {
          // Cards without scheduling data are treated as new
          newCount++;
          continue;
        }
        // Skip suspended and buried cards
        if (sched.queue < 0) continue;

        switch (sched.queue) {
          case 0: // new
            newCount++;
            break;
          case 1: // learning
          case 3: // day learning
            learnCount++;
            break;
          case 2: // review (due)
            dueCount++;
            break;
        }
      }

      return {
        id: deckId,
        name: displayName,
        fullName: deck.name,
        cardCount: cardsInDeck.length,
        templateCount: templateNames.size,
        newCount,
        learnCount,
        dueCount,
      };
    })
    .filter((subdeck) => subdeck.cardCount > 0);

  const uniqueTemplates = new Set(
    ankiData.cards.flatMap((card) => card.templates.map((template) => template.name)),
  );

  const displayName = getDisplayName(ankiData.deckName, subdecks);

  const tree = buildDeckTree(subdecks);

  return {
    name: displayName,
    cardCount: ankiData.cards.length,
    templateCount: uniqueTemplates.size,
    subdecks,
    tree,
  };
}

/**
 * Build a nested tree from flat subdecks using "::" hierarchy in fullName.
 * Virtual parent nodes are created for intermediate levels that have no cards.
 * Parent counts are aggregated from their descendants.
 */
function buildDeckTree(subdecks: SubDeckInfo[]): DeckTreeNode[] {
  // Map fullName -> subdeck for quick lookup
  const deckMap = new Map(subdecks.map((d) => [d.fullName, d]));

  // Collect all unique path prefixes (including virtual parents)
  const allPaths = new Set<string>();
  for (const d of subdecks) {
    const parts = d.fullName.split("::");
    for (let i = 1; i <= parts.length; i++) {
      allPaths.add(parts.slice(0, i).join("::"));
    }
  }

  // Build nodes for every path
  const nodeMap = new Map<string, DeckTreeNode>();
  for (const path of allPaths) {
    const existing = deckMap.get(path);
    const parts = path.split("::");
    const displayName = parts[parts.length - 1]!;

    nodeMap.set(path, {
      id: existing?.id ?? path,
      name: displayName,
      fullName: path,
      cardCount: existing?.cardCount ?? 0,
      templateCount: existing?.templateCount ?? 0,
      newCount: existing?.newCount ?? 0,
      learnCount: existing?.learnCount ?? 0,
      dueCount: existing?.dueCount ?? 0,
      children: [],
      depth: parts.length - 1,
    });
  }

  // Wire parent-child relationships
  const roots: DeckTreeNode[] = [];
  for (const [path, node] of nodeMap) {
    const parts = path.split("::");
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("::");
      const parent = nodeMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  // Sort children alphabetically at each level
  const sortChildren = (nodes: DeckTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  // Aggregate counts bottom-up: parent totals include all descendants
  const aggregate = (node: DeckTreeNode) => {
    for (const child of node.children) {
      aggregate(child);
      node.newCount += child.newCount;
      node.learnCount += child.learnCount;
      node.dueCount += child.dueCount;
      node.cardCount += child.cardCount;
    }
  };
  for (const root of roots) aggregate(root);

  return roots;
}

function getDisplayName(deckName: string, subdecks: SubDeckInfo[]) {
  if (deckName !== "Default" || subdecks.length === 0) {
    return deckName;
  }

  const parentNames = subdecks
    .map((subdeck) => {
      const parts = subdeck.fullName.split("::");
      return parts.length > 1 ? parts[0] : null;
    })
    .filter((name): name is string => name !== null);

  const allSameParent =
    parentNames.length > 0 && parentNames.every((name) => name === parentNames[0]);

  return allSameParent ? parentNames[0]! : deckName;
}
