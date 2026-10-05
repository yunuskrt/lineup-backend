import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'lineup:public';

// Skips SessionGuard: the route needs no session
export const Public = () => SetMetadata(IS_PUBLIC, true);
