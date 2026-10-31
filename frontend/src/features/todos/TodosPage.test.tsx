import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../test/todoFixture'
import { useNotice } from '../../hooks/useNotice'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'
import { TodosHeader } from './components/TodosHeader'
import { ClearCompletedDialog } from './components/ClearCompletedDialog'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: vi.fn(() => <h1>Tasks</h1>),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({ TodoList: () => <p>Task list</p> }))
vi.mock('./components/TodoEditor', () => ({ TodoEditor: () => null }))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: () => null,
}))
vi.mock('./components/ClearCompletedDialog', () => ({
  ClearCompletedDialog: vi.fn(() => null),
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

beforeEach(() => vi.clearAllMocks())

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('calculates completedCount and passes it to TodosHeader', () => {
  const completedTodo = { ...todoFixture, id: 1, completed: true }
  const activeTodo = { ...todoFixture, id: 2, completed: false }
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [
      completedTodo,
      activeTodo,
      { ...todoFixture, id: 3, completed: true },
    ],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  const calls = vi.mocked(TodosHeader).mock.calls
  expect(calls[calls.length - 1][0]).toEqual(
    expect.objectContaining({ completedCount: 2 }),
  )
})

it('renders ClearCompletedDialog when onClearCompleted is invoked', async () => {
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [{ ...todoFixture, completed: true }],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(vi.mocked(ClearCompletedDialog)).not.toHaveBeenCalled()
  const headerCalls = vi.mocked(TodosHeader).mock.calls
  const onClearCompleted =
    headerCalls[headerCalls.length - 1][0].onClearCompleted
  onClearCompleted()
  await waitFor(() => {
    expect(vi.mocked(ClearCompletedDialog)).toHaveBeenCalled()
  })
  const dialogCalls = vi.mocked(ClearCompletedDialog).mock.calls
  expect(dialogCalls[dialogCalls.length - 1][0]).toEqual(
    expect.objectContaining({
      count: 1,
      busy: false,
    }),
  )
})

it('notifies with singular message when one task is cleared', async () => {
  const notify = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [{ ...todoFixture, completed: true }],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  const headerCalls = vi.mocked(TodosHeader).mock.calls
  const onClearCompleted =
    headerCalls[headerCalls.length - 1][0].onClearCompleted
  onClearCompleted()
  await waitFor(() => {
    expect(vi.mocked(ClearCompletedDialog)).toHaveBeenCalled()
  })
  const dialogCalls = vi.mocked(ClearCompletedDialog).mock.calls
  const onCleared = dialogCalls[dialogCalls.length - 1][0].onCleared
  onCleared(1)
  expect(notify).toHaveBeenCalledWith('1 completed task cleared.')
})

it('notifies with plural message when multiple tasks are cleared', async () => {
  const notify = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [
      { ...todoFixture, id: 1, completed: true },
      { ...todoFixture, id: 2, completed: true },
    ],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  const headerCalls = vi.mocked(TodosHeader).mock.calls
  const onClearCompleted =
    headerCalls[headerCalls.length - 1][0].onClearCompleted
  onClearCompleted()
  await waitFor(() => {
    expect(vi.mocked(ClearCompletedDialog)).toHaveBeenCalled()
  })
  const dialogCalls = vi.mocked(ClearCompletedDialog).mock.calls
  const onCleared = dialogCalls[dialogCalls.length - 1][0].onCleared
  onCleared(5)
  expect(notify).toHaveBeenCalledWith('5 completed tasks cleared.')
})
