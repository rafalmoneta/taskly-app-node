---
name: backend-testing
description: Conventions for Vitest unit tests in backend/ (Express 5, Prisma 7, zod, supertest). File layout, fixtures, Prisma spies, router tests, and coverage thresholds. Use before writing or changing a test under backend/tests.
---

# Backend testing conventions

## Files

- Tests live flat in `backend/tests/`, one file per source module, named after it. `src/features/todos/router.ts` is tested in `tests/router.test.ts`. Vitest runs only `tests/**/*.test.ts`.
- You may write `backend/tests/**/*.test.ts` and `backend/tests/**/fixture*.ts`.
- Import `it`, `expect`, `vi`, and the hooks you use from `vitest`.
- Import sources and fixtures with the `.ts` extension: `'../src/features/todos/mappers.ts'`, `'./fixture.ts'`.
- `tests/fixture.ts` exports `record`, a Prisma row with `Date` fields, and `todo`, its API shape with string dates. Spread them to vary a field: `{ ...record, due_date: null }`.
- Match the existing style: single quotes and semicolons. The backend has no formatter.

## Idioms

- Pure modules (`validators.ts`, `mappers.ts`): table cases with `it.each`, `%j` or `%s` in the title, and `safeParse(input).success` for rejections.
- Repository: build the real Prisma client and spy on its delegate. No database connection opens. Restore the spies with a top-level `afterEach(() => vi.restoreAllMocks())`.
  ```ts
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  ```
  Assert the arguments Prisma received, `toHaveBeenCalledWith({ where: { id: 1 } })`, and the mapped result.
- Router: mount it on a bare app with a store of `vi.fn()`, then call it with supertest.
  ```ts
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  const response = await request(app).post('/api/todos').send({ title: 'Task' });
  ```
  Assert `response.status` and `response.body`. For a 422, assert `expect(repository.create).not.toHaveBeenCalled()`.

## Modules without tests yet

- `factory.ts` and `api/health.ts`: pass `createApp` the client from `createDatabase(...)` and spy on its delegates, as in the repository tests. `/api/health` calls `database.todo.findFirst`. Silence the 500 handler with `vi.spyOn(console, 'error').mockImplementation(() => {})`.
- `core/config.ts` loads the repo-root `.env` on import. Set every variable it reads with `vi.stubEnv`. The code treats `''` as missing. Call `vi.unstubAllEnvs()` in `afterEach`.

## Limits

- `vitest.config.ts` requires 100% statements, branches, functions, and lines for `src/features/todos/validators.ts` and `src/features/todos/mappers.ts`. Give every new branch there its own case, or the full run fails.
- List in `not_covered` what needs a real database or port: the SQL in `initialize` (`core/database.ts`), and startup and shutdown in `core/lifespan.ts` and `main.ts`.
- `src/generated/**` and `**/types.ts` are outside coverage. Leave them untested.
