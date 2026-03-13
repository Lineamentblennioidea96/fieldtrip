import { SchemaProperty, SchemaType } from './types';

function resolveType(propDef: any): string {
  if (!propDef) return 'unknown';
  if (propDef.$ref) return propDef.$ref.split('/').pop() || '$ref';
  if (propDef.type === 'array' && propDef.items) {
    const itemType = resolveType(propDef.items);
    return `${itemType}[]`;
  }
  if (Array.isArray(propDef.type)) return propDef.type.join(' | ');
  if (propDef.type) return propDef.type;
  if (propDef.enum) return 'enum';
  if (propDef.oneOf) return 'oneOf';
  if (propDef.anyOf) return 'anyOf';
  if (propDef.allOf) return 'allOf';
  return 'unknown';
}

export function walkJsonSchemaObject(
  obj: any,
  parentName: string,
  currentPath: string,
  filePath: string,
  schemaType: SchemaType,
  results: SchemaProperty[],
  visited: Set<string> = new Set()
): void {
  const key = `${filePath}#${currentPath}`;
  if (visited.has(key)) return;
  visited.add(key);

  if (obj.properties) {
    const requiredSet = new Set<string>(obj.required || []);
    for (const [propName, propDef] of Object.entries<any>(obj.properties)) {
      const propPath = `${currentPath}.properties.${propName}`;
      results.push({
        id: `${filePath}#${propPath}`,
        name: propName,
        type: resolveType(propDef),
        description: propDef.description || '',
        schemaPath: propPath,
        filePath,
        schemaType,
        parentName,
        required: requiredSet.has(propName),
        format: propDef.format,
        ref: propDef.$ref,
      });

      if (propDef.properties || propDef.items?.properties) {
        walkJsonSchemaObject(
          propDef.properties ? propDef : propDef.items,
          propName,
          propPath,
          filePath,
          schemaType,
          results,
          visited
        );
      }
    }
  }

  // Handle allOf/oneOf/anyOf
  for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(obj[keyword])) {
      obj[keyword].forEach((subSchema: any, i: number) => {
        walkJsonSchemaObject(
          subSchema,
          parentName,
          `${currentPath}.${keyword}[${i}]`,
          filePath,
          schemaType,
          results,
          visited
        );
      });
    }
  }

  // Handle array items
  if (obj.items && typeof obj.items === 'object' && !Array.isArray(obj.items)) {
    walkJsonSchemaObject(
      obj.items,
      parentName,
      `${currentPath}.items`,
      filePath,
      schemaType,
      results,
      visited
    );
  }
}

export function parseJsonSchema(content: any, filePath: string): SchemaProperty[] {
  const results: SchemaProperty[] = [];

  // Walk top-level schema
  const name = content.title || 'root';
  walkJsonSchemaObject(content, name, name, filePath, 'jsonschema', results);

  // Walk definitions/$defs
  const defs = content.definitions || content.$defs;
  if (defs) {
    for (const [defName, defSchema] of Object.entries<any>(defs)) {
      walkJsonSchemaObject(defSchema, defName, `definitions.${defName}`, filePath, 'jsonschema', results);
    }
  }

  return results;
}
