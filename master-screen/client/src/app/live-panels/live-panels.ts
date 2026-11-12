/**
 * Public surface of the live table's dock panels. The table imports these components and passes the
 * snapshot in; the look-up panel's cards are dragged onto the canvas with the `application/x-yllir-card` type.
 */
export { LiveLogComponent } from './live-log';
export { LiveCombatComponent } from './live-combat';
export { LiveLookupComponent } from './live-lookup';
export { CompactDoc } from './compact-doc';
export { CARD_DRAG_TYPE, readCardDrag, type CardDragPayload } from './drag';
