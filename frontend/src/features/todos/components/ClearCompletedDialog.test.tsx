import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, it, expect, vi } from 'vitest'
import { Alert, Button, Drawer, Text } from '../../../design-system'
import { useClearCompletedMutation } from '../hooks/useClearCompletedMutation'
import { ClearCompletedDialog } from './ClearCompletedDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

it('renders confirmation message for single task', () => {
  const mutateAsync = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={1}
      busy={false}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )

  expect(
    screen.getByRole('dialog', { name: 'Clear completed tasks?' }),
  ).toBeVisible()
  expect(
    screen.getByText('1 completed task will be permanently deleted.'),
  ).toBeVisible()
})

it('renders confirmation message for multiple tasks', () => {
  const mutateAsync = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={5}
      busy={false}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )

  expect(
    screen.getByText('5 completed tasks will be permanently deleted.'),
  ).toBeVisible()
})

it('closes dialog when Cancel is clicked', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const mutateAsync = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={false}
      onClose={onClose}
      onCleared={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('calls onCleared with deleted count on success', async () => {
  const user = userEvent.setup()
  const onCleared = vi.fn()
  const mutateAsync = vi.fn().mockResolvedValue({ deleted: 3 })
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={false}
      onClose={vi.fn()}
      onCleared={onCleared}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Clear completed' }))

  await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce())
  expect(onCleared).toHaveBeenCalledWith(3)
})

it('disables buttons and shows pending state when busy', () => {
  const mutateAsync = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={true}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Clearing…' })).toBeDisabled()
  expect(vi.mocked(Drawer).mock.calls[0][0]).toEqual(
    expect.objectContaining({ busy: true }),
  )
})

it('disables buttons and shows pending state when mutation is pending', () => {
  const mutateAsync = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: true,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={false}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Clearing…' })).toBeDisabled()
})

it('displays error message when mutation fails', () => {
  const mutateAsync = vi.fn()
  const error = new Error('Network error')
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={false}
      onClose={vi.fn()}
      onCleared={vi.fn()}
    />,
  )

  expect(screen.getByTestId('alert')).toBeVisible()
  expect(vi.mocked(Alert).mock.calls[0][0]).toEqual(
    expect.objectContaining({ variant: 'warning' }),
  )
})

it('keeps dialog open when mutation fails', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onCleared = vi.fn()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('Network error'))
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)

  render(
    <ClearCompletedDialog
      count={3}
      busy={false}
      onClose={onClose}
      onCleared={onCleared}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Clear completed' }))

  await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce())
  expect(onCleared).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
