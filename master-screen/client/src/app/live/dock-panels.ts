/**
 * The only place where the live dock gets its panels: the three exports point at the live-panels
 * folder. The dock imports from here, so the panels can change without touching the dock.
 */
export { LiveLogComponent, LiveCombatComponent, LiveLookupComponent } from '../live-panels/live-panels';
