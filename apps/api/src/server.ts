import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { logger, setLogLevel } from "./logger";

process.on("unhandledRejection", (reason) => logger.error("process.unhandled_rejection", { error: reason }));
process.on("uncaughtException", (err) => logger.error("process.uncaught_exception", { error: err }));

const services = await bootstrap();
setLogLevel(services.config.logLevel);
const app = createApp(services);
const server = app.listen(services.config.port, () => {
  logger.info("api.listening", { url: `http://localhost:${services.config.port}`, ledger: services.ledger.mode, ai: services.ai.available ? "REAL_AI" : "FALLBACK" });
});

const shutdown = () => {
  logger.info("api.shutdown");
  server.close(() => {
    services.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
