import { SchemaProperty } from './types';
import { walkJsonSchemaObject } from './jsonschema';

export function parseAsyncAPI(content: any, filePath: string): SchemaProperty[] {
  const results: SchemaProperty[] = [];

  // components.schemas
  const schemas = content.components?.schemas;
  if (schemas) {
    for (const [schemaName, schemaDef] of Object.entries<any>(schemas)) {
      walkJsonSchemaObject(
        schemaDef,
        schemaName,
        `components.schemas.${schemaName}`,
        filePath,
        'asyncapi',
        results
      );
    }
  }

  // components.messages — extract payload schemas
  const messages = content.components?.messages;
  if (messages) {
    for (const [msgName, msgDef] of Object.entries<any>(messages)) {
      if (msgDef.payload) {
        walkJsonSchemaObject(
          msgDef.payload,
          msgName,
          `components.messages.${msgName}.payload`,
          filePath,
          'asyncapi',
          results
        );
      }
    }
  }

  // channels — inline message payloads
  const channels = content.channels;
  if (channels) {
    for (const [channelName, channelDef] of Object.entries<any>(channels)) {
      // AsyncAPI 2.x
      for (const op of ['publish', 'subscribe']) {
        const message = channelDef[op]?.message;
        if (message?.payload) {
          walkJsonSchemaObject(
            message.payload,
            `${channelName} ${op}`,
            `channels.${channelName}.${op}.message.payload`,
            filePath,
            'asyncapi',
            results
          );
        }
      }

      // AsyncAPI 3.x — channels have messages directly
      if (channelDef.messages) {
        for (const [msgName, msgDef] of Object.entries<any>(channelDef.messages)) {
          if (msgDef.payload) {
            walkJsonSchemaObject(
              msgDef.payload,
              `${channelName}.${msgName}`,
              `channels.${channelName}.messages.${msgName}.payload`,
              filePath,
              'asyncapi',
              results
            );
          }
        }
      }
    }
  }

  return results;
}
