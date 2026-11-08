import type { z } from 'zod';
import { validationError } from './errors';

/** Parses input with a zod schema, throwing a 400 VALIDATION_ERROR on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw validationError(result.error);
  return result.data;
}
