import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { validationExceptionFactory } from './common/errors/validation-exception.factory';
import { buildLoggerParams } from './common/logging/logger.config';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { MailModule } from './infrastructure/mail/mail.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { FilesModule } from './modules/files/files.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { AuditModule } from './modules/audit/audit.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuthModule } from './modules/auth/auth.module';
import { AUTH_RATE_LIMIT_KEY } from './modules/auth/decorators/auth.decorators';
import { HealthModule } from './modules/health/health.module';
import { InstitutionsModule } from './modules/institutions/institutions.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { TeachingModule } from './modules/teaching/teaching.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { ImportsModule } from './modules/imports/imports.module';
import { GradingModule } from './modules/grading/grading.module';
import { GradebookModule } from './modules/gradebook/gradebook.module';
import { PeopleModule } from './modules/people/people.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: buildLoggerParams,
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { name: 'default', ttl: config.rateLimit.ttlMs, limit: config.rateLimit.max },
        {
          // Límite estricto por IP solo en los endpoints marcados con @AuthRateLimit().
          name: 'auth',
          ttl: config.rateLimit.ttlMs,
          limit: config.rateLimit.authMax,
          skipIf: (context) =>
            Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getHandler()) !== true,
        },
      ],
    }),
    PrismaModule,
    MailModule,
    StorageModule,
    FilesModule,
    AuditModule,
    AuthModule,
    AccessControlModule,
    HealthModule,
    UsersModule,
    InstitutionsModule,
    AcademicsModule,
    DashboardModule,
    PeopleModule,
    EnrollmentsModule,
    TeachingModule,
    AdmissionsModule,
    PrivacyModule,
    ImportsModule,
    GradingModule,
    GradebookModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class AppModule {}
