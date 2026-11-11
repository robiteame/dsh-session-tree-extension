// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionBranchList } from '../src/client/SessionBranchList.tsx'
import { SessionForkLineage } from '../src/client/fork-lineage.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = (value: string): SessionId => value as SessionId
const Menu = SessionBranchList as unknown as ComponentType<Record<string, unknown>>
const t = (key: string): string => zh[key as keyof typeof zh] ?? key

function fixture() {
  const lineage = new SessionForkLineage()
  lineage.record({ childId: sid('child'), parentId: sid('source'), summary: 'Branch prompt' })
  const state = {
    ids: ['source', 'child', 'other'],
    byId: Object.fromEntries(['source', 'child', 'other'].map(id => [id, {
      id,
      displayTitle: 'Same title',
      retainedBy: {},
      ...(id === 'child' ? { parentId: 'source' } : {}),
    }])),
  } as unknown as SessionListState
  return {
    lineage,
    useSessions: <T,>(select: (value: SessionListState) => T): T => select(state),
    openSession: vi.fn(),
    t,
  }
}

function NativeRows({ ids }: { ids: readonly string[] }) {
  return (
    <div role="tree">
      {ids.map(id => (
        <div key={id} role="treeitem" aria-selected="false" data-row-key={`session:${id}`}>
          Same title
        </div>
      ))}
    </div>
  )
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-row-key="session:${id}"]`)
  if (element === null) throw new Error(`Missing native row ${id}`)
  return element
}

describe('native session branch row matching', () => {
  it('uses native identities when duplicate titles and sidebar ordering differ from the session store', async () => {
    render(<NativeRows ids={['child', 'other', 'source']} />)
    render(<Menu {...fixture()} />)

    await waitFor(() => {
      const host = document.querySelector('[data-session-tree-branch-target="source"]')
      expect(host?.previousElementSibling).toBe(row('source'))
      expect(host?.querySelector('[data-branch-session-id="child"]')).not.toBeNull()
      expect(row('child').style.display).toBe('none')
    })
    expect(row('source').style.display).toBe('')
    expect(row('other').style.display).toBe('')
  })

  it('does not treat unkeyed search result divs as native rows when the keyed sidebar is present', async () => {
    const search = render(
      <div role="tree">
        <div role="treeitem" aria-selected="true" data-testid="search-result">Same title</div>
      </div>,
    )
    render(<NativeRows ids={['child', 'source']} />)
    render(<Menu {...fixture()} />)

    await waitFor(() => {
      const host = document.querySelector('[data-session-tree-branch-target="source"]')
      expect(host?.previousElementSibling).toBe(row('source'))
      expect(row('child').style.display).toBe('none')
    })
    const searchRow = search.getByTestId('search-result')
    expect(searchRow.style.display).toBe('')
    expect(searchRow.nextElementSibling).toBeNull()
  })

  it('keeps a child visible until its source row and inline replacement are mounted', async () => {
    const native = render(<NativeRows ids={['child', 'other']} />)
    render(<Menu {...fixture()} />)
    expect(document.querySelector('[data-session-tree-branch-host]')).toBeNull()
    expect(row('child').style.display).toBe('')

    native.rerender(<NativeRows ids={['child', 'other', 'source']} />)
    await waitFor(() => {
      const host = document.querySelector('[data-session-tree-branch-target="source"]')
      expect(host?.previousElementSibling).toBe(row('source'))
      expect(row('child').style.display).toBe('none')
    })
  })
})
