/** The parts of a Scryfall card object Swapsmith uses (https://scryfall.com/docs/api/cards). */
export interface ScryCard {
  id: string;
  oracle_id?: string;
  name: string;
  /** An alternate name printed on some versions, e.g. "Panther Idol" on Mind's Eye. */
  flavor_name?: string;
  set: string;
  set_name: string;
  collector_number: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  /** Mana colors (and C) the card can produce, when it can. */
  produced_mana?: string[];
  power?: string;
  toughness?: string;
  rarity?: string;
  keywords?: string[];
  oracle_text?: string;
  /** Popularity across all Commander decks on EDHREC; 1 is the most played card. */
  edhrec_rank?: number;
  /** Who painted the card's art; with `illustration_id` it names one artwork across all printings. */
  artist?: string;
  illustration_id?: string;
  /** How good the card image is: missing, placeholder, lowres or highres_scan. */
  image_status?: string;
  color_identity: string[];
  /** Legality by format ("legal", "not_legal", "banned", "restricted"); only Commander is kept in most fixtures. */
  legalities: { commander?: string } & Record<string, string | undefined>;
  finishes: string[];
  prices: { usd: string | null; usd_foil: string | null; usd_etched: string | null };
  tcgplayer_id?: number;
  tcgplayer_etched_id?: number;
  purchase_uris?: { tcgplayer?: string };
  image_uris?: { small?: string; normal?: string; art_crop?: string };
  card_faces?: Array<{ name: string; oracle_id?: string; type_line?: string; mana_cost?: string; oracle_text?: string; power?: string; toughness?: string; image_uris?: { small?: string; normal?: string; art_crop?: string } }>;
}

export interface ScryList<T> {
  object: 'list';
  data: T[];
  has_more?: boolean;
  total_cards?: number;
  not_found?: Array<Record<string, string>>;
  /** Terms Scryfall ignored instead of failing (an unknown keyword, a bad regex); the results then ignore them too. */
  warnings?: string[];
}
