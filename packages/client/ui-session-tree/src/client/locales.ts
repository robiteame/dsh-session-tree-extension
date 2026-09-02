/** `session-tree` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.title': '会话树',
  'panel.open': '展开会话树',
  'panel.close': '收起会话树',
  'panel.empty': '还没有任何节点 —— 让 Agent 使用 session_tree 记录第一轮对话。',
  'panel.error': '读取会话树失败',
  'panel.branch': '分支',
  'panel.nodes': '个节点',
  'panel.cursor': '当前节点',
  'panel.selectedHint': '点击节点可设为当前命令目标',
  'panel.select': '选择该节点',
  'panel.jump': '跳转到该节点',
  'panel.jump.failed': '跳转失败',
  'panel.refresh': '刷新',
  'panel.head': '分支头',
  'panel.fork': '从此节点分叉',
  'node.role.system': '系统',
  'node.role.user': '用户',
  'node.role.assistant': '助手',
  'node.role.tool': '工具',
  'node.summary': '摘要',
  'node.noMessage': '（无消息）',
} satisfies Record<string, string>

/** The session-tree namespace key union. */
export type SessionTreeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.title': 'Session tree',
  'panel.open': 'Expand session tree',
  'panel.close': 'Collapse session tree',
  'panel.empty': 'No nodes yet — have the agent record the first turns with session_tree.',
  'panel.error': 'Failed to read session tree',
  'panel.branch': 'Branch',
  'panel.nodes': 'nodes',
  'panel.cursor': 'Current node',
  'panel.selectedHint': 'Click a node to bind tree commands',
  'panel.select': 'Select this node',
  'panel.jump': 'Jump to this node',
  'panel.jump.failed': 'Jump failed',
  'panel.refresh': 'Refresh',
  'panel.head': 'branch head',
  'panel.fork': 'Fork from this node',
  'node.role.system': 'System',
  'node.role.user': 'User',
  'node.role.assistant': 'Assistant',
  'node.role.tool': 'Tool',
  'node.summary': 'Summary',
  'node.noMessage': '(no message)',
} satisfies Record<SessionTreeKey, string>
