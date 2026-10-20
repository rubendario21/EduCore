import { Module } from '@nestjs/common';
import { TeachingModule } from '../teaching/teaching.module';
import { UsersModule } from '../users/users.module';
import { GuardiansService, StaffService } from './guardians-staff.service';
import { GuardiansController, StaffController, StudentsController } from './people.controller';
import { PeopleRepository } from './people.repository';
import { PersonResolver } from './person-resolver';
import { StudentsService } from './students.service';

@Module({
  imports: [UsersModule, TeachingModule],
  controllers: [StudentsController, GuardiansController, StaffController],
  providers: [PeopleRepository, PersonResolver, StudentsService, GuardiansService, StaffService],
  exports: [PeopleRepository, PersonResolver, StudentsService],
})
export class PeopleModule {}
