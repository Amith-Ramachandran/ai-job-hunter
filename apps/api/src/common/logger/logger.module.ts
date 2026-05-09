/**
 * Pino logger configuration.
 *
 * - In development: pretty-prints to stdout for readability.
 * - In production: structured JSON, one log per line — friendly to log
 *   aggregators (CloudWatch, Datadog, etc.).
 *
 * Every HTTP request gets a child logger with a generated request ID, so any
 * log line emitted during a request can be traced back to the exact request.
 */
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Generate a request ID if the client didn't send one. Echoed back
        // in the response header so frontend errors can be correlated to
        // backend logs.
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id = typeof existing === 'string' ? existing : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req,res',
                  messageFormat: '{req.method} {req.url} - {msg}',
                },
              },
        // Don't log healthcheck pings — too noisy. Match any /health/* route.
        autoLogging: {
          ignore: (req) => typeof req.url === 'string' && req.url.startsWith('/health'),
        },
      },
    }),
  ],
})
export class LoggerModule {}
