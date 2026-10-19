import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GuardiansService, StaffService } from './guardians-staff.service';
import { GuardiansController, StaffController, StudentsController } from './people.controller';
import { PeopleRepository } from './people.repository';
import { PersonResolver } from './person-resolver';
import { StudentsService } from './students.service';

@Module({
  imports: [UsersModule],
  controllers: [StudentsController, GuardiansController, StaffController],
  providers: [PeopleRepository, PersonResolver, StudentsService, GuardiansService, StaffService],
})
export class PeopleModule {}
