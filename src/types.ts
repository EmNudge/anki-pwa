export interface SubDeckInfo {
  id: string;
  name: string;
  fullName: string;
  cardCount: number;
  templateCount: number;
  newCount: number;
  learnCount: number;
  dueCount: number;
}

export interface DeckTreeNode extends SubDeckInfo {
  children: DeckTreeNode[];
  depth: number;
}

export interface DeckInfo {
  name: string;
  cardCount: number;
  templateCount: number;
  subdecks: SubDeckInfo[];
  tree: DeckTreeNode[];
}
