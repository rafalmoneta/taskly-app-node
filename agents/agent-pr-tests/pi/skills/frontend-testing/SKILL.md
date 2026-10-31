---
name: frontend-testing
description: Conventions for Vitest unit tests in frontend/ (React 19, Testing Library, TanStack Query, jsdom). File layout, the design-system mock, queries, user events, and hook tests. Use before writing or changing a test under frontend/src.
---

# Frontend testing conventions

## Files

- Put the test next to its source: `TodoItem.tsx` gets `TodoItem.test.tsx`. Use `.test.ts` when the test has no JSX.
- You may write `frontend/src/**/*.test.ts`, `frontend/src/**/*.test.tsx`, and `frontend/src/test/**` except `setup.ts`, which every test loads.
- Import `describe`, `it`, `expect`, `vi`, and the hooks you use from `vitest`. `vite.config.ts` leaves `globals` off, so a missing import passes `typecheck` and fails the run with `ReferenceError: it is not defined`.
- Import sources without an extension: `import { TodoItem } from './TodoItem'`.
- Use `todoFixture` from `src/test/todoFixture.ts` for a `Todo`. `src/test/setup.ts` loads the jest-dom matchers and runs `cleanup` after each test.
- `.prettierrc.json` sets no semicolons, single quotes, and trailing commas.

## Components

- Mock the design system in every test that renders a design-system component. Use the relative path from the test to `src/design-system`:
  ```tsx
  vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
  ```
- The mocks in `src/design-system/mocks.tsx` render native elements. `Button` is a `<button>`. `Input`, `Select`, and `Checkbox` wrap their control in a `<label>`. `Drawer` is a `role="dialog"` named by `title`, rendered only when `isOpen`. `Alert` has `data-testid="alert"`.
- Query by role and accessible name: `getByRole('button', { name: 'Save task' })`, `getByRole('dialog', { name: 'Delete task?' })`, `getByLabelText('Priority')`. Use `getByTestId('alert')` only for `Alert`.
- Assert a design-system prop through its mock, and clear the mocks before each test:
  ```tsx
  beforeEach(() => vi.clearAllMocks())
  expect(vi.mocked(Alert).mock.calls[0][0]).toEqual(expect.objectContaining({ variant: 'success' }))
  ```
- Drive input with `const user = userEvent.setup()`, then `await user.click(...)`, `user.type`, or `user.selectOptions`. Wait for async results with `await waitFor(() => expect(...))`.
- Replace the hooks and child components a component uses:
  ```tsx
  vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))
  vi.mocked(useDeleteTodoMutation).mockReturnValue({ isPending: false, error: null, mutateAsync } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  ```

## Modules and hooks

- API modules: `vi.mock('../../../lib/http', () => ({ request: vi.fn() }))`, then assert the path and the init passed to `request`.
- Plain hooks: `renderHook(() => useNotice())` and read `result.current`. For a timeout, call `vi.useFakeTimers()`, wrap each state change in `act` from `@testing-library/react`, as in `act(() => vi.advanceTimersByTime(4000))`, and call `vi.useRealTimers()` in `afterEach`.
- TanStack Query hooks have no tests yet. Mock `../api/todos` and render the hook in a `.test.tsx` with a fresh client:
  ```tsx
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  ```
  Assert the cache with `client.getQueryData(todoKeys.list)`.
- `lib/http.ts` has no test yet. Stub `fetch` with `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))` and call `vi.unstubAllGlobals()` in `afterEach`.

## Limits

- Leave untested `src/design-system/**` and every path in `coverage.exclude` of `vite.config.ts`.
- A component that renders new text or elements, or shows them under a condition, has behaviour to test. Render it and query the output, as in the Components section.
- List only styling in `not_covered`: CSS, styled-components styles, and layout.
