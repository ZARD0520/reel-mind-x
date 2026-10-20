import { Global, Module } from '@nestjs/common';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';

@Global()
@Module({
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
