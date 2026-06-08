/**
 * Application bootstrap.
 *
 * Wires up the Nest app with:
 *  - Pino as the global logger (replaces Nest's built-in Logger)
 *  - Global validation pipe (DTOs validated via class-validator decorators)
 *  - CORS scoped to the configured web origin
 *  - Swagger UI mounted at /docs (dev convenience; we may guard this in prod)
 *
 * The app intentionally does NOT bind to 0.0.0.0 in dev — listening on
 * localhost only avoids accidentally exposing the API on a LAN.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Buffer logs until Pino is wired in — otherwise early logs go to stdout
    // un-formatted and confuse the structured-log story.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Parses incoming Cookie headers into req.cookies — required for the
  // session auth guard and the /auth/refresh + /auth/logout endpoints to read
  // dhruva_at / dhruva_rt.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields
      forbidNonWhitelisted: true, // 400 if unknown fields present
      transform: true, // auto-transform payloads to DTO instances
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Dhruva API')
    .setDescription('Backend API for the Dhruva — auth, CVs, jobs.')
    .setVersion('0.1.0')
    // Session cookies are HttpOnly — Swagger can't drive them anyway, so
    // there's no scheme to declare. Calls from the docs UI rely on the
    // browser already having a session cookie from the running app.
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDoc);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');

  const logger = app.get(Logger);
  logger.log(`API ready on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
