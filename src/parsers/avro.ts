import { SchemaProperty } from './types';

function resolveAvroType(type: any): string {
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.map(resolveAvroType).join(' | ');
  if (typeof type === 'object') {
    if (type.type === 'array') return `${resolveAvroType(type.items)}[]`;
    if (type.type === 'map') return `map<${resolveAvroType(type.values)}>`;
    if (type.type === 'record') return type.name || 'record';
    if (type.type === 'enum') return type.name || 'enum';
    if (type.type === 'fixed') return type.name || 'fixed';
    return type.type || 'unknown';
  }
  return 'unknown';
}

function walkAvroRecord(
  schema: any,
  filePath: string,
  results: SchemaProperty[],
  pathPrefix: string = '',
  visited: Set<string> = new Set()
): void {
  if (!schema || schema.type !== 'record' || !schema.fields) return;

  const recordName = schema.name || 'unknown';
  const key = `${filePath}#${pathPrefix}.${recordName}`;
  if (visited.has(key)) return;
  visited.add(key);

  const currentPath = pathPrefix ? `${pathPrefix}.${recordName}` : recordName;

  for (const field of schema.fields) {
    results.push({
      id: `${filePath}#${currentPath}.${field.name}`,
      name: field.name,
      type: resolveAvroType(field.type),
      description: field.doc || '',
      schemaPath: `${currentPath}.${field.name}`,
      filePath,
      schemaType: 'avro',
      parentName: recordName,
      required: !isNullable(field.type),
      format: undefined,
    });

    // Recurse into nested records
    const nestedType = getNestedRecord(field.type);
    if (nestedType) {
      walkAvroRecord(nestedType, filePath, results, currentPath, visited);
    }
  }
}

function isNullable(type: any): boolean {
  if (Array.isArray(type)) return type.includes('null');
  return false;
}

function getNestedRecord(type: any): any | null {
  if (typeof type === 'object' && !Array.isArray(type) && type.type === 'record') return type;
  if (Array.isArray(type)) {
    for (const t of type) {
      if (typeof t === 'object' && t.type === 'record') return t;
    }
  }
  if (typeof type === 'object' && type.type === 'array' && typeof type.items === 'object' && type.items.type === 'record') {
    return type.items;
  }
  return null;
}

export function parseAvro(content: any, filePath: string): SchemaProperty[] {
  const results: SchemaProperty[] = [];
  walkAvroRecord(content, filePath, results);
  return results;
}
