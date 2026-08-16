import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'json-schema';
import { z } from 'zod';

/**
 * Some OpenRouter free-tier providers (observed: "Darkbloom") reject tool
 * parameter schemas containing keywords beyond a bare `type`/`properties`/
 * `required`/`enum`/`description` subset — rejected in turn: the top-level
 * `$schema` key Zod v4 stamps on, then `minLength` on a string field
 * (HTTP 422, `<tool>.parameters(.properties.<field>) uses <keyword>`).
 * The full constraint set (min/max length, etc.) still gets enforced via
 * `validate` below against the real Zod schema — only the wire schema sent
 * to the model is loosened.
 *
 * Вынесено из `tutor.ts` — тот же workaround нужен `defense-coach.ts`.
 */
const UNSUPPORTED_JSON_SCHEMA_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
]);

function stripUnsupportedJsonSchemaKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedJsonSchemaKeywords);
  if (node && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_JSON_SCHEMA_KEYWORDS.has(key)) continue;
      result[key] = stripUnsupportedJsonSchemaKeywords(value);
    }
    return result;
  }
  return node;
}

export function toolInputSchema<T extends z.ZodTypeAny>(schema: T) {
  return jsonSchema<z.infer<T>>(
    // Обход рекурсивный и по своей природе нетипизированный (произвольные узлы
    // JSON Schema), но на выходе — та же draft-7 схема без вырезанных ключевых
    // слов, поэтому тип восстанавливается на границе.
    () =>
      stripUnsupportedJsonSchemaKeywords(
        z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }),
      ) as JSONSchema7,
    {
      validate: async (value) => {
        const result = await schema.safeParseAsync(value);
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error };
      },
    },
  );
}
