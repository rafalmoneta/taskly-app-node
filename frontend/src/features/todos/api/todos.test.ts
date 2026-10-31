import { afterEach, it, expect, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))

afterEach(() => vi.clearAllMocks())

it('calls clearCompleted with DELETE method', async () => {
  vi.mocked(request).mockResolvedValue({ deleted: 3 })
  const result = await todosApi.clearCompleted()
  expect(result).toEqual({ deleted: 3 })
  expect(request).toHaveBeenCalledWith('/todos/completed', { method: 'DELETE' })
})
