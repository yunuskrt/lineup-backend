import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator.js';
import { CatalogService } from '@/catalog/catalog.service.js';
import { ContractResponse } from '@/common/contract-response.js';
import { RateLimit } from '@/common/rate-limits.js';
import { type FilterOptions, filterOptionsSchema } from '@/contract/catalog.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Public: /play renders before any session
  @Public()
  @Get('filter-options')
  @RateLimit('catalog')
  @ContractResponse(filterOptionsSchema)
  filterOptions(): Promise<FilterOptions> {
    return this.catalog.filterOptions();
  }
}
