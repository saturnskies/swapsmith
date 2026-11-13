/**
 * The query term that keeps cards with no usable art out of the art picker, for both the search and `/cards/random`.
 * Checked live 2026-11-13: `is:highres` is accepted with no `warnings` and leaves out every `placeholder` and `lowres` card
 * (a placeholder has an art_crop link too, but it is a "no image yet" picture). `-is:placeholder`, `-is:lowres`, `-has:placeholder`
 * and `has:art` are NOT supported: Scryfall answers 200 with a warning and drops them. `has:illustration_id` is accepted but
 * lets placeholders through.
 */
export const USABLE_ART = 'is:highres';
