import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitGuard } from '../tenancy/rate-limit.guard.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { pipeSse } from './sse.js';
import { ThreadsService } from './threads.service.js';

/**
 * All routes require authentication and a tenant (global guards). Every thread access goes through
 * `ThreadsService.requireThread`, which checks ownership.
 */
@Controller('threads')
@UseGuards(RateLimitGuard)
export class ThreadsController {
  constructor(@Inject(ThreadsService) private readonly threads: ThreadsService) {}

  @Post()
  @HttpCode(201)
  async create() {
    const thread = await this.threads.create(TenantContext.require().id);
    return { id: thread.id, createdAt: thread.createdAt.toISOString() };
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.threads.history(TenantContext.require().id, id);
  }

  @Post(':id/runs')
  async run(@Param('id') id: string, @Body() body: unknown, @Res() res: Response) {
    const events = await this.threads.startRun(TenantContext.require().id, id, body);
    await pipeSse(res, events);
  }

  @Post(':id/runs/resume')
  async resume(@Param('id') id: string, @Body() body: unknown, @Res() res: Response) {
    const events = await this.threads.resume(TenantContext.require().id, id, body);
    await pipeSse(res, events);
  }
}
