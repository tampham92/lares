import type { TestProject } from 'vitest/node';

/** Creates the test database (schema, WAL mode) in the main process, before any worker opens it. */
export default async function setup(project: TestProject) {
  Object.assign(process.env, project.config.env);
  const { db } = await import('../src/db/index.js');
  return () => db.close();
}
