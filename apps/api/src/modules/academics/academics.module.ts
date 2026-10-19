import { Module } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import {
  AcademicYearsController,
  CatalogController,
  SchoolGroupsController,
} from './academics.controller';
import { AcademicsRepository } from './academics.repository';
import { CatalogService } from './catalog.service';
import { SchoolGroupsService } from './school-groups.service';

@Module({
  controllers: [CatalogController, AcademicYearsController, SchoolGroupsController],
  providers: [AcademicsRepository, CatalogService, AcademicYearsService, SchoolGroupsService],
})
export class AcademicsModule {}
