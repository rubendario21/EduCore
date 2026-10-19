import { Module } from '@nestjs/common';
import { InstitutionsController } from './institutions.controller';
import { InstitutionsRepository } from './institutions.repository';
import { InstitutionsService } from './institutions.service';

@Module({
  controllers: [InstitutionsController],
  providers: [InstitutionsRepository, InstitutionsService],
})
export class InstitutionsModule {}
