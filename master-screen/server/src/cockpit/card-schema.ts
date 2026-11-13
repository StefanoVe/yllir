// The input of the combat agent's action card: the actions and traits it read from a sheet.
// Mirrors CardAction and ActionCard in shared/src/types.ts; the server checks every card with it.
import { z } from "zod";
import type { CardAction } from "../../../shared/src/types.js";

const text = (max: number) => z.string().min(1).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const damageSchema = z.strictObject({
  dice: text(120),
  type: text(120),
});

const saveSchema = z.strictObject({
  ability: text(120),
  dc: int(1, 40),
  onSuccess: text(120).optional(),
});

const usesSchema = z.strictObject({
  max: int(1, 20),
  per: text(120),
});

const actionSchema = z.strictObject({
  name: text(120),
  timing: z.enum(["own_turn", "any_turn", "others_turns"]),
  cost: z.enum(["action", "bonus", "reaction", "legendary", "free", "movement"]),
  kind: z.enum(["attack", "save", "spell", "utility", "movement"]),
  toHit: int(-10, 30).optional(),
  damage: z.array(damageSchema).optional(),
  save: saveSchema.optional(),
  range: text(120).optional(),
  area: text(120).optional(),
  recharge: text(120).optional(),
  uses: usesSchema.optional(),
  trigger: text(300).optional(),
  effect: text(400),
});

const traitSchema = z.strictObject({
  name: text(120),
  text: text(600),
});

export const cardInputSchema = z.strictObject({
  actions: z.array(actionSchema).min(1).max(40),
  traits: z.array(traitSchema).max(20).optional(),
});

export type CardInput = z.infer<typeof cardInputSchema>;

// Compile-time check: the parsed input is a valid list of CardAction and traits.
const _check: (x: CardInput) => { actions: CardAction[]; traits?: Array<{ name: string; text: string }> } = (x) => x;
void _check;
