import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodosHeader } from './TodosHeader'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('invokes creation when enabled and blocks it when disabled', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  const { rerender } = render(
    <TodosHeader
      disabled={false}
      completedCount={0}
      onCreate={onCreate}
      onClearCompleted={vi.fn()}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  expect(
    screen.getByText('Create, organize, and complete tasks.'),
  ).toBeVisible()
  const button = screen.getByRole('button', { name: 'New task' })
  await user.click(button)
  expect(onCreate).toHaveBeenCalledTimes(1)
  rerender(
    <TodosHeader
      disabled
      completedCount={0}
      onCreate={onCreate}
      onClearCompleted={vi.fn()}
    />,
  )
  expect(button).toBeDisabled()
  await user.click(button)
  expect(onCreate).toHaveBeenCalledTimes(1)
})

it('displays completed count and invokes clear callback', async () => {
  const user = userEvent.setup()
  const onClearCompleted = vi.fn()
  render(
    <TodosHeader
      disabled={false}
      completedCount={3}
      onCreate={vi.fn()}
      onClearCompleted={onClearCompleted}
    />,
  )

  const clearButton = screen.getByRole('button', {
    name: 'Clear completed (3)',
  })
  expect(clearButton).toBeVisible()
  expect(clearButton).not.toBeDisabled()
  await user.click(clearButton)
  expect(onClearCompleted).toHaveBeenCalledOnce()
})

it('disables clear button when no completed tasks', () => {
  render(
    <TodosHeader
      disabled={false}
      completedCount={0}
      onCreate={vi.fn()}
      onClearCompleted={vi.fn()}
    />,
  )

  const clearButton = screen.getByRole('button', {
    name: 'Clear completed (0)',
  })
  expect(clearButton).toBeDisabled()
})

it('disables clear button when globally disabled', () => {
  render(
    <TodosHeader
      disabled={true}
      completedCount={5}
      onCreate={vi.fn()}
      onClearCompleted={vi.fn()}
    />,
  )

  const clearButton = screen.getByRole('button', {
    name: 'Clear completed (5)',
  })
  expect(clearButton).toBeDisabled()
})
