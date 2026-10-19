import { Controller, Get, HttpStatus, Logger } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Public } from '../auth/decorators/auth.decorators';
import { HealthResponseDto, LivenessResponseDto } from './health.dto';

/**
 * Endpoints de supervisión. Son públicos y no exponen información sensible:
 * solo el estado de cada dependencia, sin versiones, hosts ni mensajes internos.
 */
@ApiTags('Sistema')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: el proceso está en ejecución' })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Readiness: la API y sus dependencias están operativas' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Alguna dependencia no está disponible' })
  async check(): Promise<HealthResponseDto> {
    const timestamp = new Date().toISOString();
    try {
      const latencyMs = await this.prisma.ping();
      return { status: 'ok', checks: { database: { status: 'up', latencyMs } }, timestamp };
    } catch (error) {
      // La causa solo va al log del servidor; al cliente se le devuelve el estado.
      this.logger.warn(
        { err: error instanceof Error ? { name: error.name, message: error.message } : error },
        'Health check: la base de datos no responde',
      );
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'La base de datos no está disponible.',
        { checks: { database: { status: 'down' } }, timestamp },
      );
    }
  }
}
