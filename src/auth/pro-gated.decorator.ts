import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { failureDoc } from '@/common/contract-response.js';

export const PRO_GATED = 'lineup:pro-gated';

// R12: public with the switch off, else Pro only
export const ProGated = (message: string) =>
  applyDecorators(
    SetMetadata(PRO_GATED, message),
    DocumentsSession(),
    ApiForbiddenResponse({
      description: `PRO_ENABLED on and a Free session: pro_required. ${message}`,
      schema: failureDoc(),
    }),
  );
