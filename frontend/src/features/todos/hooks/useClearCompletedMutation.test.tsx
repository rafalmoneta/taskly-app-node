import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { todosApi } from '../api/todos'
import { todoKeys } from '../api/queryKeys'
import { useClearCompletedMutation } from './useClearCompletedMutation'
import { todoFixture } from '../../../test/todoFixture'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))

afterEach(() => vi.clearAllMocks())

it('calls clearCompleted API and removes completed todos from cache', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const completedTodo = { ...todoFixture, id: 1, completed: true }
  const activeTodo = { ...todoFixture, id: 2, completed: false }
  client.setQueryData(todoKeys.list, [completedTodo, activeTodo])
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })

  const { result } = renderHook(() => useClearCompletedMutation(), { wrapper })
  expect(result.current.isPending).toBe(false)

  result.current.mutate()

  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(todosApi.clearCompleted).toHaveBeenCalledOnce()
  expect(client.getQueryData(todoKeys.list)).toEqual([activeTodo])
})

it('preserves cache when completed todos are filtered out', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  client.setQueryData(todoKeys.list, [{ ...todoFixture, completed: false }])
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })

  const { result } = renderHook(() => useClearCompletedMutation(), { wrapper })
  result.current.mutate()

  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toEqual([
    { ...todoFixture, completed: false },
  ])
})
