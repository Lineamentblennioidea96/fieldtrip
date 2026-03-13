import * as protobuf from 'protobufjs';
import { SchemaProperty } from './types';

function walkType(
  type: protobuf.ReflectionObject,
  filePath: string,
  results: SchemaProperty[],
  pathPrefix: string = ''
): void {
  if (type instanceof protobuf.Type) {
    const parentName = type.name;
    const currentPath = pathPrefix ? `${pathPrefix}.${parentName}` : parentName;

    for (const field of type.fieldsArray) {
      results.push({
        id: `${filePath}#${currentPath}.${field.name}`,
        name: field.name,
        type: field.repeated ? `${field.type}[]` : field.type,
        description: field.comment || '',
        schemaPath: `${currentPath}.${field.name}`,
        filePath,
        schemaType: 'protobuf',
        parentName,
        required: field.required,
        format: field.repeated ? 'repeated' : undefined,
      });
    }

    // Recurse into nested types
    if (type.nestedArray) {
      for (const nested of type.nestedArray) {
        walkType(nested, filePath, results, currentPath);
      }
    }
  } else if (type instanceof protobuf.Namespace) {
    const currentPath = pathPrefix ? `${pathPrefix}.${type.name}` : type.name;
    if (type.nestedArray) {
      for (const nested of type.nestedArray) {
        walkType(nested, filePath, results, currentPath);
      }
    }
  }
}

export async function parseProtobuf(filePath: string, absolutePath: string): Promise<SchemaProperty[]> {
  const results: SchemaProperty[] = [];

  try {
    const root = await protobuf.load(absolutePath);
    if (root.nestedArray) {
      for (const nested of root.nestedArray) {
        walkType(nested, filePath, results);
      }
    }
  } catch (err: any) {
    console.warn(`Warning: Failed to parse proto file ${filePath}: ${err.message}`);
  }

  return results;
}
