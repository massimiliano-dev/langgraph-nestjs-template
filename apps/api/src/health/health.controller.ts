import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { HEALTH_CHECK } from '../common/tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECK) private readonly check: () => Promise<void>) {}

  /** Public and tenant-free. Returns no version, host or dependency details. */
  @Public()
  @Get()
  async health() {
    try {
      await Promise.race([
        this.check(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000).unref()),
      ]);
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
