import { Module } from '@nestjs/common';
import { PermissionSyncService } from './permission-sync.service';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController],
  providers: [PermissionSyncService, RolesRepository, RolesService],
  exports: [PermissionSyncService],
})
export class AccessControlModule {}
