// Request bodies and framework answers of the print routes. Owner: master-screen server.
import { z } from 'zod';
import type { PrintState } from '../../../shared/src/types.js';

/** A sheet id: lowercase letters, digits and single dashes, up to 120 characters. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().min(1).max(120).regex(SLUG);

export const PDF_NAME = /^sheets-[0-9TZ-]+\.pdf$/;

export const STATES: [PrintState, ...PrintState[]] = ['to-print', 'printed', 'reprint'];

export const stateBody = z.object({
  id: slugSchema,
  state: z.enum(STATES),
});

export const renderBody = z.object({
  id: slugSchema,
  renderer: z.enum(['auto', 'photoshop', 'node']).optional(),
});

export const MAX_SHEET_IDS = 200;
export const MAX_COPIES = 20;

export const sheetsBody = z.object({
  ids: z.array(slugSchema).min(1).max(MAX_SHEET_IDS).optional(),
  format: z.enum(['5x7', 'a4']).optional(),
  copies: z
    .record(slugSchema, z.number().int().min(1).max(MAX_COPIES))
    .refine((copies) => Object.keys(copies).length <= MAX_SHEET_IDS, { message: 'too many copies' })
    .optional(),
  cmyk: z.boolean().optional(),
});

const cardSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  category: z.string(),
  print: z.enum(STATES).nullish(),
  hasImage: z.boolean(),
  personal: z.boolean(),
});

/** The framework `list` answer. Renderer, format and cmyk are normalised by the service. */
export const listAnswer = z.looseObject({
  cards: z.array(cardSchema),
  renderer: z.string().optional(),
  format: z.string().optional(),
  cmyk: z.boolean().optional(),
  baseUrl: z.string().optional(),
});

export type ListedCard = z.infer<typeof cardSchema>;

export const sheetAnswer = z.looseObject({
  file: z.string().nullish(),
  pages: z.number().int().min(0).optional(),
  excluded: z.array(z.looseObject({ id: z.unknown().optional(), reason: z.unknown().optional() })).optional(),
  warnings: z.array(z.looseObject({ code: z.unknown().optional(), message: z.unknown().optional() })).optional(),
});
