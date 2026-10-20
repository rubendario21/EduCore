import { Module } from '@nestjs/common';
import { AcademicTemplateService } from './academic-template.service';
import { AcademicYearsService } from './academic-years.service';
import {
  AcademicTemplatesController,
  AcademicYearsController,
  CatalogController,
  SchoolGroupsController,
} from './academics.controller';
import { AcademicsRepository } from './academics.repository';
import { CatalogService } from './catalog.service';
import { SchoolGroupsService } from './school-groups.service';

@Module({
  controllers: [
    CatalogController,
    AcademicYearsController,
    SchoolGroupsController,
    AcademicTemplatesController,
  ],
  providers: [
    AcademicsRepository,
    CatalogService,
    AcademicYearsService,
    SchoolGroupsService,
    AcademicTemplateService,
  ],
})
export class AcademicsModule {}
