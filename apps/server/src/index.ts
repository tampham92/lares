import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { authRoutes, ensureAdminUser } from './auth/index.js';
import { HttpError } from './lib/errors.js';
import { requestLang, runWithLang, t } from './i18n/index.js';
import { failInterruptedMigrations } from './migration/repo.js';
import { databaseRoutes } from './routes/databases.js';
import { dnsRoutes } from './routes/dns.js';
import { migrationRoutes } from './routes/migrations.js';
import { aiRoutes } from './routes/ai.js';
import { networkRoutes } from './routes/network.js';
import { securityRoutes } from './routes/security.js';
import { backupRoutes } from './routes/backups.js';
import { releaseRoutes } from './routes/release.js';
import { siteRoutes } from './routes/sites.js';
import { systemRoutes } from './routes/system.js';
import { templateRoutes } from './routes/templates.js';
import { wpUpdateRoutes } from './routes/wpupdates.js';
import { getLogrotate, saveLogrotate } from './services/logs.js';
import { closeMysql } from './services/mysql.js';
import { stopDevNginx, syncDevNginx } from './services/devNginx.js';
import { ensureGlobalConfig } from './services/nginx.js';
import { startCloudflareRealIp } from './services/cloudflare.js';
import { attachPanelServer } from './services/panelTls.js';
import { installSecurityHooks } from './services/security.js';
import { refreshSslExpiry, repairSites } from './services/sites.js';

const https =
  config.tlsCert && config.tlsKey && fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey)
    ? { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }
    : null;

const app = Fastify({
  ...(https ? { https } : {}),
  logger: {
    level: config.isProd ? 'info' : 'debug',
    serializers: {
      // SSE passes the JWT as ?token= - keep it out of the logs
      req: (req) => ({ method: req.method, url: req.url.replace(/([?&]token=)[^&]+/, '$1***'), remoteAddress: req.ip }),
    },
  },
  bodyLimit: 10 * 1024 * 1024,
  // Off unless LARES_TRUST_PROXY is set: otherwise X-Forwarded-For could be forged to dodge rate limits and the IP allowlist.
  trustProxy: config.trustProxy,
});

await app.register(cors, { origin: config.isProd ? false : true });
await app.register(jwt, { secret: config.secret });
await app.register(rateLimit, { global: false });

// Every request (and any background task it starts) speaks the language the UI asked for.
app.addHook('onRequest', (req, _reply, done) => {
  runWithLang(requestLang(req.headers, req.query), done);
});
installSecurityHooks(app);

app.setErrorHandler((err, req, reply) => {
  const e = err as Error & { statusCode?: number; validation?: unknown };
  const status = err instanceof HttpError ? err.statusCode : (e.statusCode ?? 500);
  if (status >= 500) req.log.error(err);
  reply.status(status).send({ error: status >= 500 && config.isProd ? t('Lỗi máy chủ: {message}', { message: e.message }) : e.message });
});

await app.register(authRoutes);
await app.register(systemRoutes);
await app.register(siteRoutes);
await app.register(databaseRoutes);
await app.register(migrationRoutes);
await app.register(templateRoutes);
await app.register(aiRoutes);
await app.register(networkRoutes);
await app.register(securityRoutes);
await app.register(backupRoutes);
await app.register(releaseRoutes);
await app.register(dnsRoutes);
await app.register(wpUpdateRoutes);

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

ensureAdminUser((msg) => app.log.warn(msg));
failInterruptedMigrations();
if (config.dryRun) app.log.warn(t('LARES_DRY_RUN=1 - các lệnh thay đổi hệ thống chỉ được ghi log, không thực thi'));
await ensureGlobalConfig((m) => app.log.info(m)).catch((err) => app.log.warn(`nginx global config: ${err.message}`));
await saveLogrotate(getLogrotate()).catch((err) => app.log.warn(`logrotate: ${err.message}`));
await repairSites((m) => app.log.warn(m)).catch((err) => app.log.warn(`repairSites: ${err.message}`));
setInterval(() => void refreshSslExpiry().catch(() => {}), 12 * 3_600_000).unref();
await syncDevNginx((m) => app.log.info(m));
startCloudflareRealIp((m) => app.log.info(m));
attachPanelServer(app.server, (m) => app.log.info(m));

const shutdown = async () => {
  await stopDevNginx().catch(() => {});
  await app.close();
  await closeMysql();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
