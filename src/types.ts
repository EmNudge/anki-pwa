export interface SubDeckInfo {
  id: string;
  name: string;
  cardCount: number;
  templateCount: number;
}

export interface DeckInfo {
  name: string;
  cardCount: number;
  templateCount: number;
  subdecks: SubDeckInfo[];
}
