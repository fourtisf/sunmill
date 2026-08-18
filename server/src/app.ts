import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { env } from './env';
import { GameError } from './lib/errors';
import { attachSession } from './auth/plugin';
import authRoutes from './routes/auth';
import configRoutes from './routes/config';
import expandRoutes from './routes/expand';
import farmRoutes from './routes/farm';
import fieldRoutes from './routes/field';
import hayRoutes from './routes/hay';
import machineRoutes from './routes/machine';
import marketRoutes from './routes/market';
import orderRoutes from './routes/orders';
import penRoutes from './routes/pen';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Tests build the app in-process and drive it with inject(); request logs
    // there are pure noise that buries the assertions.
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(cookie);

  // Every request gets its session read once, before any handler runs.
  app.addHook('onRequest', async (req) => {
    attachSession(req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GameError) {
      return reply.code(err.statusCode).send({
        error: err.code, message: err.message, details: err.details,
      });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'That request did not look right',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Slow down a moment' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong' });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found', message: 'No such route' });
  });

  await app.register(configRoutes);
  await app.register(authRoutes);
  await app.register(farmRoutes);
  await app.register(fieldRoutes);
  await app.register(machineRoutes);
  await app.register(penRoutes);
  await app.register(orderRoutes);
  await app.register(marketRoutes);
  await app.register(expandRoutes);
  await app.register(hayRoutes);

  return app;
}
