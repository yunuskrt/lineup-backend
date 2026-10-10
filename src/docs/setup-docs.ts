import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { getCookies } from 'better-auth/cookies';
import type { Auth } from '@/auth/auth.factory.js';
import { SESSION_SCHEME } from '@/auth/session-docs.decorator.js';
import { contractComponents } from '@/contract/openapi.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';

type ComponentSchemas = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>;

// Over https Better Auth adds a __Secure- prefix
function sessionCookieName(app: INestApplication): string {
  const { instance } = app.get<AuthService<Auth>>(AuthService);
  return getCookies(instance.options).sessionToken.name;
}

export function setupDocs(app: INestApplication): void {
  const cookie = sessionCookieName(app);
  const config = new DocumentBuilder()
    .setTitle('Lineup API')
    .setDescription('Every response is a { success, data | error } envelope.')
    .setVersion(String(PROTOCOL_VERSION))
    .addCookieAuth(
      cookie,
      { type: 'apiKey', in: 'cookie', name: cookie },
      SESSION_SCHEME,
    )
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
