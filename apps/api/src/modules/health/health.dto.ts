import { ApiProperty } from '@nestjs/swagger';

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';
}

export class DependencyStatusDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status: 'up' | 'down';

  @ApiProperty({ required: false, example: 3 })
  latencyMs?: number;
}

export class HealthChecksDto {
  @ApiProperty({ type: DependencyStatusDto })
  database: DependencyStatusDto;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';

  @ApiProperty({ type: HealthChecksDto })
  checks: HealthChecksDto;

  @ApiProperty({ example: '2026-10-18T22:00:00.000Z' })
  timestamp: string;
}
