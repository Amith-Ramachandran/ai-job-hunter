/**
 * InternalAuthModule — exports the InternalAuthGuard so feature modules
 * (jobs, cvs) can guard their `/internal/*` endpoints.
 *
 * Kept tiny on purpose: this is auth *plumbing*, not feature code.
 */
import { Global, Module } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard';

@Global()
@Module({
  providers: [InternalAuthGuard],
  exports: [InternalAuthGuard],
})
export class InternalAuthModule {}
