// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LatestPromptEditController } from '../src/client/LatestPromptEditor.tsx'
import { LatestPromptEditButtonSlot } from '../src/client/LatestPromptEditSlots.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('respects session access and lifecycle while allowing edits during generation', () => {
  const controller = new LatestPromptEditController({ begin: vi.fn(), submit: vi.fn() })
  let state = { removed: false, blank: false, subagent: null as unknown, pendingSubmissions: [] as unknown[], running: true }
  let access = true
  const useAccess = vi.fn(() => access)
  const props = {
    sessionId: 'source' as SessionId,
    controller,
    t: (key: keyof typeof zh) => zh[key],
    useSession: (select: (snapshot: typeof state) => unknown) => select(state),
    useAccess,
  }
  const Slot = LatestPromptEditButtonSlot as unknown as ComponentType<typeof props>
  const view = render(<Slot {...props} />)
  const button = () => screen.getByRole('button', { name: zh['edit.latest.open'] }) as HTMLButtonElement
  expect(button().disabled).toBe(false)
  expect(useAccess).toHaveBeenCalledWith('sessionTree/beginEdit')
  expect(useAccess).toHaveBeenCalledWith('sessionTree/submitEdit')
  access = false
  view.rerender(<Slot {...props} />)
  expect(button().disabled).toBe(true)
  access = true
  for (const changed of [{ removed: true }, { blank: true }, { subagent: {} }, { pendingSubmissions: [{}] }]) {
    const before = state
    state = { ...state, ...changed }
    view.rerender(<Slot {...props} />)
    expect(button().disabled).toBe(true)
    state = before
  }
})
