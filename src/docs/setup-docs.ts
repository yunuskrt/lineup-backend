import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { contractComponents } from '@/contract/openapi.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';

type ComponentSchemas = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>;

export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Lineup API')
    .setDescription('Every response is a { success, data | error } envelope.')
    .setVersion(String(PROTOCOL_VERSION))
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...(contractComponents() as ComponentSchemas),
    },
  };

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
    raw: ['json'],
  });
}
