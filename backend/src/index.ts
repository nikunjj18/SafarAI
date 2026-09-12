import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createApp } from './app.ts';
import { errorHandler } from './errors.ts';
async function start() {
  if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  const runtime = createApp();
  let closeWatcher: (() => Promise<void>) | undefined;
  if (process.env.NODE_ENV !== 'production') {
    // A Rollup watch build avoids esbuild's dependency prebundler and works in restricted Windows environments.
    const { build } = await import('vite');
    const watcher = await build({
      configFile: 'frontend/vite.config.ts',
      configLoader: 'native',
      build: { watch: {}, emptyOutDir: false },
    });
    if (!('on' in watcher)) throw new Error('Could not start frontend build watcher.');
    closeWatcher = () => watcher.close();
    try {
      await new Promise<void>((resolve, reject) =>
        watcher.on('event', (event) => {
          if (event.code === 'END') resolve();
          if (event.code === 'ERROR') reject(event.error);
        }),
      );
    } catch (error) {
      await closeWatcher();
      runtime.close();
      throw error;
    }
    console.log(
      'Frontend source changes rebuild automatically. Refresh your browser after editing. Restart for backend changes.',
    );
  }
  const client = path.resolve('dist/frontend');
  runtime.app.use(express.static(client, { index: false }));
  runtime.app.get('*', (_req, res) => res.sendFile(path.join(client, 'index.html')));
  runtime.app.use(errorHandler);
  const server = runtime.app.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log('SafarAI listening at ' + (process.env.APP_URL || 'http://localhost:' + port)),
  );
  server.on('error', (error) => {
    console.error('Server could not listen:', error.message);
    void closeWatcher?.();
    runtime.close();
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void closeWatcher?.();
    const deadline = setTimeout(() => server.closeAllConnections(), 5000);
    server.close(() => {
      clearTimeout(deadline);
      runtime.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});
