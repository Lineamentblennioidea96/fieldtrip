import { SchemaProperty } from './types';
import { walkJsonSchemaObject } from './jsonschema';

export function parseOpenAPI(content: any, filePath: string): SchemaProperty[] {
  const results: SchemaProperty[] = [];

  // OpenAPI 3.x: components.schemas
  const schemas = content.components?.schemas;
  if (schemas) {
    for (const [schemaName, schemaDef] of Object.entries<any>(schemas)) {
      walkJsonSchemaObject(
        schemaDef,
        schemaName,
        `components.schemas.${schemaName}`,
        filePath,
        'openapi',
        results
      );
    }
  }

  // Swagger 2.0: definitions
  const definitions = content.definitions;
  if (definitions) {
    for (const [defName, defSchema] of Object.entries<any>(definitions)) {
      walkJsonSchemaObject(
        defSchema,
        defName,
        `definitions.${defName}`,
        filePath,
        'openapi',
        results
      );
    }
  }

  // Also walk request/response bodies inline in paths
  if (content.paths) {
    for (const [pathStr, pathItem] of Object.entries<any>(content.paths)) {
      for (const [method, operation] of Object.entries<any>(pathItem)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          // OpenAPI 3.x requestBody
          const requestBody = operation.requestBody?.content;
          if (requestBody) {
            for (const [mediaType, mediaObj] of Object.entries<any>(requestBody)) {
              if (mediaObj.schema) {
                walkJsonSchemaObject(
                  mediaObj.schema,
                  `${method.toUpperCase()} ${pathStr} request`,
                  `paths.${pathStr}.${method}.requestBody.${mediaType}`,
                  filePath,
                  'openapi',
                  results
                );
              }
            }
          }

          // Responses
          if (operation.responses) {
            for (const [statusCode, response] of Object.entries<any>(operation.responses)) {
              const responseContent = response.content;
              if (responseContent) {
                for (const [mediaType, mediaObj] of Object.entries<any>(responseContent)) {
                  if (mediaObj.schema) {
                    walkJsonSchemaObject(
                      mediaObj.schema,
                      `${method.toUpperCase()} ${pathStr} ${statusCode}`,
                      `paths.${pathStr}.${method}.responses.${statusCode}.${mediaType}`,
                      filePath,
                      'openapi',
                      results
                    );
                  }
                }
              }
              // Swagger 2.0 response schema
              if (response.schema) {
                walkJsonSchemaObject(
                  response.schema,
                  `${method.toUpperCase()} ${pathStr} ${statusCode}`,
                  `paths.${pathStr}.${method}.responses.${statusCode}`,
                  filePath,
                  'openapi',
                  results
                );
              }
            }
          }
        }
      }
    }
  }

  return results;
}
