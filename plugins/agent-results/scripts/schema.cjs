'use strict';
// Small, closed JSON Schema vocabulary for bundled wire contracts. Unknown
// keywords fail rather than weakening validation when the contract changes.
const known = new Set(['$schema', '$defs', '$ref', 'type', 'const', 'enum', 'anyOf', 'properties', 'propertyNames', 'required', 'additionalProperties', 'items', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'pattern', 'format']);
function validate(schema, value, root = schema, depth = 0) {
  if (depth > 128 || !schema || typeof schema !== 'object') return false;
  if (Object.keys(schema).some(key => !known.has(key))) throw new Error('Unsupported bundled schema vocabulary');
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw new Error('External schema references are unsupported');
    const target = schema.$ref.slice(2).split('/').reduce((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    if (!validate(target, value, root, depth + 1)) return false;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.anyOf && !schema.anyOf.some(item => validate(item, value, root, depth + 1))) return false;
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => type === 'null' ? value === null : type === 'object' ? object : type === 'array' ? Array.isArray(value) :
    type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type)) return false;
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) ||
    (schema.maximum !== undefined && value > schema.maximum) || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum))) return false;
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) return false;
    if (schema.format && !['uuid', 'date-time'].includes(schema.format)) throw new Error('Unsupported schema format');
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every(item => validate(schema.items, item, root, depth + 1))) return false;
  }
  if (object) {
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
    for (const key of Object.keys(value)) {
      if (schema.propertyNames && !validate(schema.propertyNames, key, root, depth + 1)) return false;
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        if (!validate(schema.properties[key], value[key], root, depth + 1)) return false;
      } else if (schema.additionalProperties === false) return false;
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !validate(schema.additionalProperties, value[key], root, depth + 1)) return false;
    }
  }
  return true;
}
module.exports = { validate };
