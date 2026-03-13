export type SchemaType = 'openapi' | 'asyncapi' | 'protobuf' | 'avro' | 'jsonschema';

export interface SchemaProperty {
  id: string;
  name: string;
  type: string;
  description: string;
  schemaPath: string;
  filePath: string;
  schemaType: SchemaType;
  parentName: string;
  required: boolean;
  format?: string;
  ref?: string;
}

export interface ParseResult {
  properties: SchemaProperty[];
  filePath: string;
  schemaType: SchemaType;
}
