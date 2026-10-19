import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileController, UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, ProfileController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
