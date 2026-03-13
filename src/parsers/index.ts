import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { SchemaProperty, SchemaType } from './types';
import { parseOpenAPI } from './openapi';
import { parseAsyncAPI } from './asyncapi';
import { parseProtobuf } from './protobuf';
import { parseAvro } from './avro';
import { parseJsonSchema } from './jsonschema';

function detectSchemaType(content: any, ext: string): SchemaType | null {
  if (ext === '.proto') return 'protobuf';
  if (ext === '.avsc') return 'avro';
  if (typeof content === 'object' && content !== null) {
    if (content.openapi || content.swagger) return 'openapi';
    if (content.asyncapi) return 'asyncapi';
    if (content.type === 'record' && content.fields) return 'avro';
    if (content.$schema || content.properties || content.type || content.definitions || content.$defs) return 'jsonschema';
  }
  return null;
}

export async function parseFile(absolutePath: string, relativePath: string): Promise<SchemaProperty[]> {
  const ext = path.extname(absolutePath).toLowerCase();

  // Proto files need special handling (protobufjs loads from file path)
  if (ext === '.proto') {
    return parseProtobuf(relativePath, absolutePath);
  }

  // Read and parse file content
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  let content: any;

  try {
    if (ext === '.yaml' || ext === '.yml') {
      content = YAML.parse(raw);
    } else {
      content = JSON.parse(raw);
    }
  } catch (err: any) {
    console.warn(`Warning: Failed to parse ${relativePath}: ${err.message}`);
    return [];
  }

  if (!content || typeof content !== 'object') return [];

  const schemaType = detectSchemaType(content, ext);
  if (!schemaType) return [];

  switch (schemaType) {
    case 'openapi':
      return parseOpenAPI(content, relativePath);
    case 'asyncapi':
      return parseAsyncAPI(content, relativePath);
    case 'avro':
      return parseAvro(content, relativePath);
    case 'jsonschema':
      return parseJsonSchema(content, relativePath);
    default:
      return [];
  }
}
