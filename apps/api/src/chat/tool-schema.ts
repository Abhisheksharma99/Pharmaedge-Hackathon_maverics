/**
 * Strict validation of tool-call arguments against the tool's JSON Schema, before the tool runs.
 *
 * The model's arguments are untrusted input: invalid types, ranges, enums, patterns, sizes or unknown properties
 * are REJECTED (the model gets the reason and may call again), never coerced. Supports the schema subset the tool
 * definitions use: object (properties, required, additionalProperties: false), string (enum, pattern, maxLength),
 * integer/number (minimum, maximum), boolean, array (items, minItems, maxItems).
 */

export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  pattern?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  description?: string;
};

export function validate(value: unknown, schema: Schema, path = 'arguments'): string[] {
  const errors: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path} must be an object`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (obj[key] === undefined) errors.push(`${path}.${key} is required`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
        continue;
      }
      if (v === undefined || v === null) continue; // optional property left empty
      errors.push(...validate(v, sub, `${path}.${key}`));
    }
    return errors;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items!, `${path}[${i}]`)));
    return errors;
  }
  if (t === 'string') {
    if (typeof value !== 'string') return [`${path} must be a string`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format`);
  } else if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (t === 'integer' && !Number.isInteger(value))) return [`${path} must be ${t === 'integer' ? 'an integer' : 'a number'}`];
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be ≤ ${schema.maximum}`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [`${path} must be true or false`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
  return errors;
}
