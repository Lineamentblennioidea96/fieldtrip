import MiniSearch from 'minisearch';
import { SchemaProperty } from '../parsers/types';

export function createIndex(properties: SchemaProperty[]): MiniSearch<SchemaProperty> {
  const miniSearch = new MiniSearch<SchemaProperty>({
    fields: ['name', 'type', 'description'],
    storeFields: [
      'name', 'type', 'description', 'schemaPath', 'filePath',
      'schemaType', 'parentName', 'required', 'format', 'ref',
    ],
    idField: 'id',
    searchOptions: {
      boost: { name: 3, description: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  miniSearch.addAll(properties);
  return miniSearch;
}
