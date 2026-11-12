/** Separator between the parts of a category line, such as "Morvalle · Luoghi". */
const PART_SEPARATOR = " · ";

/**
 * Capitalises the first letter of each part of a category line separated by " · ".
 * Only the first letter of a part changes; the rest of the text is kept as it is.
 */
export function capitalizeParts(text: string): string {
  return text
    .split(PART_SEPARATOR)
    .map((part) => (part ? part.charAt(0).toLocaleUpperCase() + part.slice(1) : part))
    .join(PART_SEPARATOR);
}
