import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { type AuthUserView } from './auth-context';
import { Authenticated } from '../access-control/authorization';
import { AuthService, type AuthenticatedSession } from './auth.service';
import { type AuthContext, type ClientInfo } from './auth.types';
import { AuthRateLimit, Client, CurrentAuth, Public } from './decorators/auth.decorators';
import {
  AuthSessionResponseDto,
  AuthUserDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { CSRF_HEADER, CsrfGuard } from './guards/csrf.guard';
import { PasswordService } from './password.service';
import { REFRESH_COOKIE_NAME, SessionService } from './session.service';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  private respondWithSession(res: Response, session: AuthenticatedSession): AuthSessionResponseDto {
    this.sessions.setRefreshCookie(res, session.issued);
    // Las respuestas con tokens nunca deben guardarse en cachés intermedias.
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken: session.issued.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.issued.expiresIn,
      user: session.user,
    };
  }

  private refreshCookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  @Post('login')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión con correo y contraseña' })
  @ApiOkResponse({ type: AuthSessionResponseDto, description: 'Además define la cookie de sesión' })
  async login(
    @Body() body: LoginDto,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.respondWithSession(res, await this.auth.login(body.email, body.password, client));
  }

  @Post('refresh')
  @Public()
  @AuthRateLimit()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: CSRF_HEADER, required: true, description: 'Debe valer "1"' })
  @ApiOperation({ summary: 'Renovar la sesión con la cookie (rota el token)' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async refresh(
    @Req() req: Request,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    try {
      return this.respondWithSession(res, await this.auth.refresh(this.refreshCookie(req), client));
    } catch (error) {
      // Una sesión inválida deja de tener cookie; una carrera entre pestañas no.
      if ((error as { code?: string }).code !== 'SESSION_ROTATED')
        this.sessions.clearRefreshCookie(res);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader({ name: CSRF_HEADER, required: true, description: 'Debe valer "1"' })
  @ApiOperation({ summary: 'Cerrar sesión (revoca la sesión en el servidor)' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie(req), client);
    this.sessions.clearRefreshCookie(res);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usuario autenticado, sus roles y permisos' })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentAuth() auth: AuthContext): Promise<AuthUserView> {
    return this.auth.me(auth);
  }

  @Post('password/forgot')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar un enlace para restablecer la contraseña' })
  @ApiAcceptedResponse({ description: 'Siempre 202, exista o no la cuenta' })
  async forgot(@Body() body: ForgotPasswordDto, @Client() client: ClientInfo) {
    await this.passwords.requestReset(body.email, client);
    return {
      message:
        'Si el correo pertenece a una cuenta, recibirás un enlace para restablecer la contraseña.',
    };
  }

  @Post('password/reset')
  @Public()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Definir una contraseña nueva con el enlace del correo (recuperación o activación)',
  })
  @ApiNoContentResponse()
  async reset(@Body() body: ResetPasswordDto, @Client() client: ClientInfo): Promise<void> {
    await this.passwords.resetWithToken(body.token, body.newPassword, client);
  }

  @Post('password/change')
  @Authenticated()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar la contraseña (cierra las demás sesiones)' })
  @ApiNoContentResponse()
  async change(
    @Body() body: ChangePasswordDto,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.passwords.change(auth, body.currentPassword, body.newPassword, client);
  }
}
