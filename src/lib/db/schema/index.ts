/**
 * Единая точка входа схемы. Передаётся в `drizzle({ schema })`,
 * чтобы работал relational query API (`db.query.*`).
 *
 * Порядок реэкспорта отражает порядок создания таблиц в миграции.
 */
export * from './enums';
export * from './types';
export * from './users';
export * from './learning';
export * from './content';
export * from './practice';
export * from './fsrs';
export * from './metacognition';
export * from './agents';
export * from './projects';
export * from './sources';
export * from './experiments';
export * from './push';

export * from './relations';
