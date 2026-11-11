/** Add an edit action beside the resident copy control without replacing native UI. */
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LatestPromptEditButton, type LatestPromptEditController } from './LatestPromptEditor.tsx'
import type { SessionTreeKey } from './locales.ts'

export interface LatestPromptBubbleActionProps {
  sessionId: SessionId
  nodeKey: string
  nodeId: string
  controller: LatestPromptEditController
  t: (key: SessionTreeKey) => string
  disabled?: boolean
}

const ROOT = '[data-conversation-content][data-conversation-session]'
const NODE = '[data-chat-node-key]'
const HOST = 'data-session-tree-edit-action'

interface CopyTarget {
  node: Element
  row: Element
  wrapper: Element
  copy: HTMLButtonElement
}

function findCopyTarget(root: Element, nodeKey: string): CopyTarget | null {
  for (const node of root.querySelectorAll(NODE)) {
    if (node.getAttribute('data-chat-node-key') !== nodeKey || node.closest(ROOT) !== root) continue
    const kind = node.getAttribute('data-chat-flow-kind')
    if (kind !== 'user' && kind !== 'steering') continue
    for (const row of node.querySelectorAll('[data-clock="start"]')) {
      if (row.closest(NODE) !== node || row.closest(ROOT) !== root) continue
      // Labels change with locale and copy feedback; native ordering is stable.
      const copy = [...row.querySelectorAll('button')].find(button => button.closest(`[${HOST}]`) === null
        && button.closest(NODE) === node && button.closest('[data-clock]') === row && button.closest(ROOT) === root)
      if (copy === undefined) continue
      let wrapper: Element = copy
      while (wrapper.parentElement !== row && wrapper.parentElement !== null) wrapper = wrapper.parentElement
      if (wrapper.parentElement === row) return { node, row, wrapper, copy }
    }
  }
  return null
}

export function LatestPromptBubbleAction({ sessionId, nodeKey, nodeId, controller, t, disabled }: LatestPromptBubbleActionProps) {
  const marker = useRef<HTMLSpanElement>(null)
  const [portalHost, setPortalHost] = useState<HTMLSpanElement | null>(null)

  useLayoutEffect(() => {
    const root = marker.current?.closest(ROOT)
    setPortalHost(null)
    if (root === undefined || root === null || root.getAttribute('data-conversation-session') !== sessionId) return
    let host: HTMLSpanElement | null = null
    let target: CopyTarget | null = null
    let active = true
    const synchronize = () => {
      if (!active) return
      const sameSession = root.getAttribute('data-conversation-session') === sessionId
      const kind = target?.node.getAttribute('data-chat-flow-kind')
      // Streaming and portal mutations need no conversation-wide node search
      // while the original native copy control and its placement remain valid.
      if (sameSession && target !== null && host?.isConnected
        && target.node.getAttribute('data-chat-node-key') === nodeKey && (kind === 'user' || kind === 'steering')
        && target.node.closest(ROOT) === root && target.row.closest(NODE) === target.node
        && target.row.closest(ROOT) === root && target.row.getAttribute('data-clock') === 'start'
        && target.copy.isConnected && target.wrapper.contains(target.copy)
        && target.copy.closest('[data-clock]') === target.row && target.copy.closest(NODE) === target.node
        && target.wrapper.parentElement === target.row && host.parentElement === target.row
        && host.previousElementSibling === target.wrapper) return
      target = sameSession ? findCopyTarget(root, nodeKey) : null
      host?.remove()
      host = null
      if (target !== null) {
        host = root.ownerDocument.createElement('span')
        host.setAttribute(HOST, '')
        target.wrapper.after(host)
      }
      setPortalHost(host)
    }
    const observer = new MutationObserver(synchronize)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-conversation-session', 'data-chat-node-key', 'data-chat-flow-kind', 'data-clock'],
    })
    synchronize()
    return () => {
      active = false
      observer.disconnect()
      host?.remove()
    }
  }, [sessionId, nodeKey])

  return <>
    <span ref={marker} hidden data-session-tree-edit-marker="" />
    {portalHost === null ? null : createPortal(
      <LatestPromptEditButton sessionId={sessionId} nodeId={nodeId} controller={controller} t={t} disabled={disabled === true} />,
      portalHost,
    )}
  </>
}
