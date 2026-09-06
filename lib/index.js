var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name3, symbol) => (symbol = Symbol[name3]) ? symbol : Symbol.for("Symbol." + name3);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name3 in all)
    __defProp(target, name3, { get: all[name3], enumerable: true });
};
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name3, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name: name3, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name3, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name3]() {
    return __privateGet(this, extra);
  }, set [name3](x) {
    return __privateSet(this, extra, x);
  } }, name3));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name3) : __name(target, name3);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name3, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name3 in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name3];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name3] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name3, desc), p ? k ^ 4 ? extra : desc : target;
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// packages/extensions/pi-agent-session-tree/src/index.ts
import { isSurfaceEvent } from "@deepseek-ai/dsh-session";
import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";

// packages/extensions/pi-agent-session-tree/src/session-tree.ts
var SNAPSHOT_VERSION = 1;
var fail = (code, message) => ({ ok: false, error: { code, message } });
var clone = (value) => JSON.parse(JSON.stringify(value));
function nodeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
var SessionTree = class {
  /**
   * Create an empty tree, or restore one from a versioned snapshot.
   * @param sessionId - owning session identity.
   * @param snapshot - optional durable snapshot to restore.
   * @throws Error when the snapshot is malformed (version, ownership, cursor).
   */
  constructor(sessionId, snapshot) {
    this.sessionId = sessionId;
    if (snapshot === void 0) return;
    if (!isSnapshot(snapshot, sessionId)) throw new Error("invalid session tree snapshot");
    for (const node of snapshot.nodes) this.nodesById.set(node.nodeId, clone(node));
    this.cursorId = snapshot.cursor;
    this.selectedNodeId = snapshot.selectedNodeId ?? null;
    if (typeof snapshot.nativeEventSeq === "number") this.syncedSessionEventSeq = snapshot.nativeEventSeq;
    if (typeof snapshot.activeBranch === "string") this.activeBranchName = snapshot.activeBranch;
    if (snapshot.branchHeads !== void 0) {
      for (const [name3, head] of Object.entries(snapshot.branchHeads)) {
        if (this.nodesById.has(head)) this.branchHeads.set(name3, head);
      }
    }
    if (this.cursorId !== null && this.branchHeads.size === 0) {
      this.branchHeads.set(this.activeBranchName, this.cursorId);
    }
  }
  nodesById = /* @__PURE__ */ new Map();
  cursorId = null;
  selectedNodeId = null;
  activeBranchName = "main";
  branchHeads = /* @__PURE__ */ new Map();
  syncedSessionEventSeq = -1;
  /** Mint a node id guaranteed absent from this tree (collision-safe). */
  mintNodeId() {
    let id = nodeId();
    while (this.nodesById.has(id)) id = nodeId();
    return id;
  }
  /** @returns the current cursor node id, or null before the first append. */
  get cursor() {
    return this.cursorId;
  }
  /** Explicit node bound to context-aware UI commands. */
  get selectedNode() {
    return this.selectedNodeId;
  }
  /** Bind /fork and /clone to an existing node without changing cursor semantics. */
  select(nodeId2) {
    if (!this.nodesById.has(nodeId2)) return fail("NODE_NOT_FOUND", `node '${nodeId2}' was not found`);
    this.selectedNodeId = nodeId2;
    return { ok: true, value: { nodeId: nodeId2 } };
  }
  /** @returns the branch label the next append joins. */
  get activeBranch() {
    return this.activeBranchName;
  }
  /**
   * Append one new node as a child of the cursor. The cursor's parent chain
   * is never touched; the new node joins the active branch unless one is
   * named. Historical nodes stay byte-identical.
   * @param message - standard LLM message to carry.
   * @param options - optional branch override, summary, and JSON extras.
   * @returns the created node, or a standard error for invalid input.
   */
  /** Capture mutable projection state so an external durable write can commit atomically. */
  checkpoint() {
    return this.snapshot();
  }
  /** Roll back to a previously captured checkpoint after a durable append fails. */
  rollback(snapshot) {
    if (!isSnapshot(snapshot, this.sessionId)) return fail("INVALID_SNAPSHOT", "checkpoint does not belong to this session");
    this.nodesById.clear();
    for (const node of snapshot.nodes) this.nodesById.set(node.nodeId, clone(node));
    this.cursorId = snapshot.cursor;
    this.selectedNodeId = snapshot.selectedNodeId ?? null;
    this.activeBranchName = snapshot.activeBranch;
    this.branchHeads.clear();
    for (const [name3, head] of Object.entries(snapshot.branchHeads ?? {})) this.branchHeads.set(name3, head);
    this.syncedSessionEventSeq = snapshot.nativeEventSeq ?? -1;
    return { ok: true, value: void 0 };
  }
  append(message, options = {}) {
    if (!isMessage(message)) return fail("INVALID_ARGUMENT", "message.role and message.content are required");
    const branch = options.branch === void 0 ? this.activeBranchName : options.branch.trim();
    if (branch.length === 0) return fail("INVALID_ARGUMENT", "branch must not be empty");
    const node = {
      nodeId: this.mintNodeId(),
      parentId: this.cursorId,
      forkCount: 0,
      type: "message",
      branch,
      summary: options.summary?.trim() || summarize(message.content),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: clone(message),
      content: clone(options.content ?? [{ type: "text", text: message.content }]),
      ...options.model === void 0 ? {} : { model: options.model },
      ...options.usage === void 0 ? {} : { usage: clone(options.usage) },
      ...options.cost === void 0 ? {} : { cost: options.cost },
      ...options.error === void 0 ? {} : { error: options.error },
      ...options.metadata === void 0 ? {} : { metadata: clone(options.metadata) }
    };
    this.nodesById.set(node.nodeId, node);
    this.cursorId = node.nodeId;
    this.activeBranchName = branch;
    this.branchHeads.set(branch, node.nodeId);
    return { ok: true, value: clone(node) };
  }
  /**
   * Move the cursor to an existing node (root-to-node path replay). Old
   * branches remain intact; the next append forks from the target.
   * @param target - target node id, or null to reset before any node.
   * @returns the new cursor and the reconstructed root-to-cursor messages.
   */
  jump(target) {
    if (target !== null && !this.nodesById.has(target)) {
      return fail("NODE_NOT_FOUND", `node '${target}' was not found`);
    }
    this.cursorId = target;
    const node = target === null ? void 0 : this.nodesById.get(target);
    this.activeBranchName = node?.branch ?? this.activeBranchName;
    return { ok: true, value: { cursor: this.cursorId, messages: this.messagesFrom(target) } };
  }
  /**
   * Fork the active cursor from a historical node. This is the Pi `/fork`
   * primitive: old nodes remain intact and the next tree append becomes a child.
   * The owning service selects the matching Harness model surface path.
   */
  fork(target, branch = "fork") {
    const result = this.branch(target, branch);
    if (!result.ok) return fail(result.error.code, result.error.message);
    const count = this.directChildren(target).length;
    return { ok: true, value: { cursor: target, branch: result.value.branch, forkCount: count } };
  }
  /**
   * Set the branch label the next append joins and park the cursor at the
   * chosen node, without appending anything.
   * @param target - node to branch from (must exist).
   * @param branch - new branch label (non-empty).
   * @returns the new cursor and branch.
   */
  branch(target, branch) {
    if (!this.nodesById.has(target)) return fail("NODE_NOT_FOUND", `node '${target}' was not found`);
    const trimmed = branch.trim();
    if (trimmed.length === 0) return fail("INVALID_ARGUMENT", "branch must not be empty");
    this.cursorId = target;
    this.activeBranchName = trimmed;
    this.branchHeads.set(trimmed, target);
    return { ok: true, value: { cursor: target, branch: trimmed } };
  }
  /**
   * Branch with a summary of the abandoned path: park the cursor at `target`
   * (like {@link branch}), then append a summary node whose parent is the
   * target. The abandoned branch's nodes stay untouched.
   * @param target - node to branch from.
   * @param summary - summary text stored on the new node.
   * @returns the created summary node.
   */
  branchWithSummary(target, summary) {
    if (!this.nodesById.has(target)) return fail("NODE_NOT_FOUND", `node '${target}' was not found`);
    if (summary.trim().length === 0) return fail("INVALID_ARGUMENT", "summary must not be empty");
    this.cursorId = target;
    const node = {
      nodeId: this.mintNodeId(),
      parentId: target,
      forkCount: 0,
      type: "branch_summary",
      branch: this.activeBranchName,
      summary: summary.trim(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      content: [{ type: "text", text: summary.trim() }],
      metadata: { kind: "branch_summary", from: target }
    };
    this.nodesById.set(node.nodeId, node);
    this.cursorId = node.nodeId;
    this.branchHeads.set(this.activeBranchName, node.nodeId);
    return { ok: true, value: clone(node) };
  }
  /**
   * Reconstruct the standard LLM messages array for the path root→node
   * (defaults to the cursor). System/user/assistant/tool messages keep their
   * roles; branch-summary nodes carry no message and stay out of the array.
   * @param from - target node id, or null for the empty path.
   * @returns messages in conversation order (root first).
   */
  messages(from = this.cursorId) {
    return this.messagesFrom(from);
  }
  /**
   * @returns all nodes in creation order (defensive copies).
   */
  log(fromSeq = 0) {
    return this.list().slice(fromSeq).map((node, index) => ({ seq: fromSeq + index, node }));
  }
  replay(records) {
    let expected = this.nodesById.size;
    const known = new Set(this.nodesById.keys());
    for (const record of records) {
      if (record.seq !== expected || known.has(record.node.nodeId)) return fail("INVALID_SNAPSHOT", "session tree log sequence or node identity is invalid");
      if (!isNode(record.node) || record.node.parentId !== null && !known.has(record.node.parentId)) return fail("INVALID_SNAPSHOT", "session tree log topology is invalid");
      known.add(record.node.nodeId);
      expected += 1;
    }
    for (const record of records) {
      this.nodesById.set(record.node.nodeId, clone(record.node));
      const nativeSeq = record.node.metadata?.sessionEventSeq;
      if (typeof nativeSeq === "number") this.markSessionEventSeq(nativeSeq);
    }
    const last = records[records.length - 1]?.node;
    if (last !== void 0) {
      this.cursorId = last.nodeId;
      this.activeBranchName = last.branch;
      this.branchHeads.set(last.branch, last.nodeId);
    }
    return { ok: true, value: { applied: records.length } };
  }
  list() {
    return clone([...this.nodesById.values()]);
  }
  /**
   * @returns named branch pointers and their reachable nodes. Branch identity
   * comes from the session-level head map; node.branch is display metadata only.
   */
  branches() {
    return [...this.branchHeads].map(([name3, headId]) => {
      const nodeIds = [];
      let current = headId;
      while (current !== null) {
        const node = this.nodesById.get(current);
        if (node === void 0) break;
        nodeIds.push(current);
        current = node.parentId;
      }
      nodeIds.reverse();
      return { name: name3, headId, nodeIds };
    });
  }
  /** Return a compact Pi-style session status projection. */
  info() {
    const usage = {};
    let cost = 0;
    for (const node of this.nodesById.values()) {
      if (node.usage !== void 0) {
        for (const [key, value] of Object.entries(node.usage)) {
          if (typeof value === "number") usage[key] = (usage[key] ?? 0) + value;
        }
      }
      if (typeof node.cost === "number") cost += node.cost;
    }
    const tokenCount = Object.entries(usage).reduce((total, [key, value]) => key.endsWith("Tokens") ? total + value : total, 0);
    return {
      sessionId: this.sessionId,
      branchHeads: Object.fromEntries(this.branchHeads),
      nodeCount: this.nodesById.size,
      messageCount: [...this.nodesById.values()].filter((node) => node.message !== void 0).length,
      branchCount: this.branches().length,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      selectedNodeId: this.selectedNodeId,
      currentPathLength: this.currentPath().length,
      ...Object.keys(usage).length > 0 ? { usage } : {},
      ...tokenCount !== 0 ? { tokenCount } : {},
      ...cost !== 0 ? { cost } : {},
      snapshotVersion: SNAPSHOT_VERSION
    };
  }
  /** @returns the full read view served to the browser panel. */
  view() {
    return {
      sessionId: this.sessionId,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      selectedNodeId: this.selectedNodeId,
      branchHeads: Object.fromEntries(this.branchHeads),
      nodes: this.list(),
      branches: this.branches()
    };
  }
  /** @returns a versioned durable snapshot (defensive copy). */
  snapshot() {
    return clone({
      version: SNAPSHOT_VERSION,
      sessionId: this.sessionId,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      ...this.syncedSessionEventSeq < 0 ? {} : { nativeEventSeq: this.syncedSessionEventSeq },
      branchHeads: Object.fromEntries(this.branchHeads),
      selectedNodeId: this.selectedNodeId,
      nodes: [...this.nodesById.values()]
    });
  }
  /** Return the current leaf's root-to-leaf node path. */
  currentPath(from = this.cursorId) {
    const path = [];
    let current = from;
    while (current !== null) {
      const node = this.nodesById.get(current);
      if (node === void 0) break;
      path.push(clone(node));
      current = node.parentId;
    }
    return path.reverse();
  }
  /** Return the greatest native Session event seq already projected into this tree. */
  lastSessionEventSeq() {
    return this.syncedSessionEventSeq;
  }
  /** Advance the native Session event watermark after a successful sync/write. */
  markSessionEventSeq(seq) {
    if (Number.isSafeInteger(seq) && seq > this.syncedSessionEventSeq) this.syncedSessionEventSeq = seq;
  }
  /** Rewind the watermark when a persisted native tail is shorter than the sidecar expected. */
  limitSessionEventSeq(seq) {
    if (Number.isSafeInteger(seq) && seq < this.syncedSessionEventSeq) this.syncedSessionEventSeq = seq;
  }
  /** @returns true when a node with this id exists. */
  has(nodeId2) {
    return this.nodesById.has(nodeId2);
  }
  /** @returns direct child ids, used to expose the derived fork count. */
  directChildren(parentId) {
    return [...this.nodesById.values()].filter((node) => node.parentId === parentId).map((node) => node.nodeId);
  }
  messagesFrom(from) {
    const path = [];
    let current = from;
    while (current !== null) {
      const node = this.nodesById.get(current);
      if (node === void 0) break;
      if (node.message !== void 0) path.push(clone(node.message));
      current = node.parentId;
    }
    return path.reverse();
  }
};
var SessionTreeStore = class {
  trees = /* @__PURE__ */ new Map();
  /** Look up a tree without creating one. */
  get(sessionId) {
    return this.trees.get(sessionId);
  }
  /** Look up a tree, or return the standard SESSION_NOT_FOUND error. */
  require(sessionId) {
    const tree = this.trees.get(sessionId);
    return tree === void 0 ? fail("SESSION_NOT_FOUND", `session '${sessionId}' was not found`) : { ok: true, value: tree };
  }
  /** Create a new tree session. Existing ids are never silently reset. */
  create(sessionId) {
    if (this.trees.has(sessionId)) throw new Error(`session '${sessionId}' already exists`);
    const tree = new SessionTree(sessionId);
    this.trees.set(sessionId, tree);
    return tree;
  }
  /** Clone the active branch into an independent session with fresh node ids. */
  clone(sourceSessionId, targetSessionId) {
    if (this.trees.has(targetSessionId)) return fail("SESSION_ALREADY_EXISTS", `session '${targetSessionId}' already exists`);
    const source = this.trees.get(sourceSessionId);
    if (source === void 0) return fail("SESSION_NOT_FOUND", `session '${sourceSessionId}' was not found`);
    const snapshot = source.snapshot();
    const byId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
    const activeIds = /* @__PURE__ */ new Set();
    let current = snapshot.cursor;
    while (current !== null) {
      activeIds.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    const activeNodes = snapshot.nodes.filter((node) => activeIds.has(node.nodeId));
    const ids = /* @__PURE__ */ new Map();
    for (const node of activeNodes) ids.set(node.nodeId, nodeId());
    const cloned = {
      ...snapshot,
      sessionId: targetSessionId,
      cursor: snapshot.cursor === null ? null : ids.get(snapshot.cursor) ?? null,
      branchHeads: Object.fromEntries(Object.entries(snapshot.branchHeads ?? {}).map(([name3, head]) => [name3, ids.get(head)]).filter((entry) => entry[1] !== void 0)),
      nodes: activeNodes.map((node) => ({
        ...node,
        nodeId: ids.get(node.nodeId) ?? nodeId(),
        parentId: node.parentId === null ? null : ids.get(node.parentId) ?? null
      }))
    };
    this.trees.set(targetSessionId, new SessionTree(targetSessionId, cloned));
    return { ok: true, value: { sessionId: targetSessionId } };
  }
  /** Replace one session's tree from a previously validated candidate. */
  replace(sessionId, tree) {
    if (tree.sessionId !== sessionId) throw new Error("tree does not belong to session");
    this.trees.set(sessionId, tree);
  }
  /** Replace one session's tree from a snapshot. */
  load(snapshot) {
    try {
      const tree = new SessionTree(snapshot.sessionId, snapshot);
      this.trees.set(tree.sessionId, tree);
      return { ok: true, value: { sessionId: tree.sessionId } };
    } catch (error) {
      return fail("INVALID_SNAPSHOT", error instanceof Error ? error.message : "invalid snapshot");
    }
  }
  /** @returns all session ids with a live tree, in creation order. */
  list() {
    return [...this.trees.keys()];
  }
};
function isMessage(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.role === "string" && ["system", "user", "assistant", "tool"].includes(record.role) && typeof record.content === "string";
}
function isSnapshot(value, sessionId) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  if (record.version !== SNAPSHOT_VERSION || record.sessionId !== sessionId) return false;
  const nodes = record.nodes;
  if (!Array.isArray(nodes) || nodes.some((node) => !isNode(node))) return false;
  if (!hasValidTopology(nodes)) return false;
  const cursor = record.cursor;
  if (cursor !== null && typeof cursor !== "string") return false;
  if (typeof cursor === "string" && !nodes.some((node) => node.nodeId === cursor)) return false;
  if (record.selectedNodeId !== void 0 && record.selectedNodeId !== null && (typeof record.selectedNodeId !== "string" || !nodes.some((node) => node.nodeId === record.selectedNodeId))) return false;
  if (record.nativeEventSeq !== void 0 && (typeof record.nativeEventSeq !== "number" || !Number.isSafeInteger(record.nativeEventSeq) || record.nativeEventSeq < 0)) return false;
  if (record.branchHeads !== void 0 && !isJsonRecord(record.branchHeads)) return false;
  if (record.branchHeads !== void 0 && Object.entries(record.branchHeads).some(([name3, head]) => name3.length === 0 || typeof head !== "string" || !nodes.some((node) => node.nodeId === head))) return false;
  if (typeof record.activeBranch !== "string" || record.activeBranch.length === 0) return false;
  if (record.branchHeads !== void 0 && record.branchHeads[record.activeBranch] === void 0 && cursor !== null) return false;
  return true;
}
function isNode(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  if (typeof record.nodeId !== "string" || record.parentId !== null && typeof record.parentId !== "string" || typeof record.branch !== "string" || typeof record.summary !== "string" || typeof record.createdAt !== "string") return false;
  if (record.type !== void 0 && !["message", "tool_call", "tool_result", "model_change", "compaction", "branch_summary", "custom"].includes(record.type)) return false;
  if (record.forkCount !== void 0 && (typeof record.forkCount !== "number" || !Number.isInteger(record.forkCount) || record.forkCount < 0)) return false;
  if (record.message !== void 0 && !isMessage(record.message)) return false;
  if (record.content !== void 0 && (!Array.isArray(record.content) || record.content.some((part) => !isContentPart(part)))) return false;
  if (record.cost !== void 0 && (typeof record.cost !== "number" || !Number.isFinite(record.cost))) return false;
  if (record.usage !== void 0 && !isJsonRecord(record.usage)) return false;
  return record.error === void 0 || typeof record.error === "string";
}
function isContentPart(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  if (record.type === "text" || record.type === "reasoning") return typeof record.text === "string";
  if (record.type === "tool_call") return typeof record.id === "string" && typeof record.name === "string" && isJsonValue(record.arguments);
  if (record.type === "tool_result") return typeof record.toolCallId === "string" && typeof record.content === "string" && (record.isError === void 0 || typeof record.isError === "boolean");
  return false;
}
function isJsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value);
}
function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}
function hasValidTopology(nodes) {
  const ids = new Set(nodes.map((node) => node.nodeId));
  if (ids.size !== nodes.length) return false;
  const parentOf = new Map(nodes.map((node) => [node.nodeId, node.parentId]));
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) return false;
  }
  for (const node of nodes) {
    let steps = 0;
    let current = node.nodeId;
    while (current !== null) {
      if (steps > nodes.length) return false;
      current = parentOf.get(current) ?? null;
      steps += 1;
    }
  }
  return true;
}
function summarize(content) {
  const flat = content.replace(/\s+/gu, " ").trim();
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`;
}
var sessionTreeStore = new SessionTreeStore();

// packages/extensions/pi-agent-session-tree/src/session-tree-marker.ts
function sessionTreeMarkerOf(event) {
  const data = event.data;
  const marker = data.treeRestore;
  if (typeof marker !== "object" || marker === null) return void 0;
  const candidate = marker;
  if (candidate.kind !== "cursor") return void 0;
  if (candidate.nodeId !== null && typeof candidate.nodeId !== "string") return void 0;
  return { kind: "cursor", nodeId: candidate.nodeId };
}
function isSessionTreeRestoreEvent(event) {
  return sessionTreeMarkerOf(event) !== void 0;
}

// packages/extensions/pi-agent-session-tree/src/session-event-adapter.ts
function sessionEventsToTreeNodes(events, initialParentId = null) {
  const nodes = [];
  let parentId = initialParentId;
  for (const event of events) {
    const projected = projectEvent(event, parentId);
    if (projected === void 0) continue;
    nodes.push(projected);
    parentId = projected.nodeId;
  }
  return nodes;
}
function projectEvent(event, parentId) {
  if (isSessionTreeRestoreEvent(event)) return void 0;
  let message;
  let content;
  let type = "custom";
  let summary = event.type;
  let usage;
  let model;
  let metadata = {
    sessionEventType: event.type,
    sessionEventSeq: event.seq,
    sourceEventSeq: event.seq
  };
  if (event.type === "session-tree/node") {
    return { ...event.data.node, metadata: { ...event.data.node.metadata, sessionEventType: event.type, sessionEventSeq: event.seq, sourceEventSeq: event.seq } };
  } else if (event.type === "session-tree/snapshot") {
    return void 0;
  } else if (event.type === "user/message") {
    type = "message";
    message = { role: "user", content: textOf(event.data.content) };
    content = partsOf(event.data.content);
    summary = message.content;
  } else if (event.type === "assistant/message") {
    type = "message";
    message = { role: "assistant", content: textOf(event.data.message.content) };
    content = partsOf(event.data.message.content);
    summary = message.content;
    if (event.data.usage !== void 0) usage = event.data.usage;
    if (event.data.interrupted === true) metadata = { ...metadata, interrupted: true };
  } else if (event.type === "tool/call") {
    type = "tool_call";
    const args = parseJson(event.data.arguments);
    content = [{ type: "tool_call", id: String(event.data.callId), name: event.data.name, arguments: args }];
    summary = `${event.data.name}(${event.data.arguments})`;
  } else if (event.type === "request/context") {
    type = "model_change";
    model = event.data.model;
    summary = `model: ${event.data.provider}/${event.data.model}`;
    content = [{ type: "text", text: summary }];
  } else if (event.type === "tool/result") {
    const toolBlock = event.data.message.content[0];
    type = "tool_result";
    message = { role: "tool", content: textOf(event.data.message.content), toolCallId: String(toolBlock.toolCallId) };
    content = [{ type: "tool_result", toolCallId: String(toolBlock.toolCallId), content: message.content }];
    summary = message.content;
  } else {
    return void 0;
  }
  const surfaceOp = event.surfaceOp;
  if (typeof surfaceOp === "object" && surfaceOp !== null && surfaceOp.op === "replace") {
    const replacement = surfaceOp;
    const sourceEventSeqs = event.sourceEventSeqs;
    type = "compaction";
    metadata = {
      ...metadata,
      surfaceReplacement: true,
      ...typeof replacement.start === "number" ? { replaceStart: replacement.start } : {},
      ...typeof replacement.end === "number" ? { replaceEnd: replacement.end } : {},
      sourceEventSeqs: Array.isArray(sourceEventSeqs) ? sourceEventSeqs.filter((seq) => typeof seq === "number") : []
    };
    summary = `compaction: ${summary}`;
  }
  return {
    nodeId: `session-event-${event.seq}`,
    parentId,
    forkCount: 0,
    type,
    branch: "main",
    summary: summarize2(summary),
    createdAt: new Date(event.time).toISOString(),
    ...message === void 0 ? {} : { message },
    ...content === void 0 ? {} : { content },
    ...model === void 0 ? {} : { model },
    ...usage === void 0 ? {} : { usage },
    metadata
  };
}
function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item !== null && "text" in item ? String(item.text ?? "") : "").join("");
  return String(value ?? "");
}
function partsOf(value) {
  if (!Array.isArray(value)) return [{ type: "text", text: textOf(value) }];
  const parts = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || !("type" in item)) continue;
    const block = item;
    if (block.type === "text" && typeof block.text === "string") parts.push({ type: "text", text: block.text });
    else if (block.type === "reasoning" && typeof block.text === "string") parts.push({ type: "reasoning", text: block.text });
    else if (block.type === "tool-call" && typeof block.id === "string" && typeof block.name === "string" && typeof block.arguments === "string") parts.push({ type: "tool_call", id: block.id, name: block.name, arguments: parseJson(block.arguments) });
    else if (block.type === "tool-result" && typeof block.toolCallId === "string") parts.push({ type: "tool_result", toolCallId: block.toolCallId, content: textOf(block.content), ...typeof block.isError === "boolean" ? { isError: block.isError } : {} });
  }
  return parts;
}
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function summarize2(value) {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`;
}

// packages/extensions/pi-agent-session-tree/src/session-tree-sidecar.ts
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
var SIDECAR_VERSION = 1;
function defaultSidecarRoot() {
  const home = process.env.DSH_HOME ?? process.env.HOME ?? ".";
  return join(home, "storages", "session-tree");
}
function sidecarFilename(sessionId) {
  return `${sessionId.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.json`;
}
var SessionTreeSidecar = class {
  constructor(root = defaultSidecarRoot()) {
    this.root = root;
  }
  /** Read and validate the latest snapshot for one session. */
  load(sessionId) {
    const path = join(this.root, sidecarFilename(sessionId));
    if (!existsSync(path)) return void 0;
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (record.version !== SIDECAR_VERSION || record.sessionId !== sessionId || typeof record.savedAt !== "number" || record.snapshot === void 0) {
        return void 0;
      }
      return new SessionTree(sessionId, record.snapshot);
    } catch {
      return void 0;
    }
  }
  /**
   * Atomically persist one tree. I/O errors are deliberately contained:
   * the native Session log remains the source of truth and can rebuild a
   * linear projection even when the sidecar directory is unavailable.
   */
  save(sessionId, tree) {
    const record = {
      version: SIDECAR_VERSION,
      sessionId,
      savedAt: Date.now(),
      snapshot: tree.snapshot()
    };
    const path = join(this.root, sidecarFilename(sessionId));
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temporary, JSON.stringify(record), { encoding: "utf8", mode: 384 });
      renameSync(temporary, path);
      return true;
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
      }
      return false;
    }
  }
};
var activeSidecar = new SessionTreeSidecar();
function getSessionTreeSidecar() {
  return activeSidecar;
}
function persistSessionTree(tree) {
  return activeSidecar.save(tree.sessionId, tree);
}

// packages/extensions/pi-agent-session-tree/src/index.ts
function supportsSelectedMessageSurface(session) {
  const candidate = session;
  return typeof candidate.selectMessageSurface === "function" && typeof candidate.messageSurfaceNodes === "function";
}
function supportsDurableSessionTreeEvents(session) {
  return supportsSelectedMessageSurface(session);
}
function appendSessionTreeEvent(session, type, data) {
  if (!supportsDurableSessionTreeEvents(session)) return void 0;
  return session.append(type, data);
}
function syncSessionTree(agent) {
  const sessionId = agent.session.id;
  const existing = sessionTreeStore.get(sessionId);
  const restored = existing === void 0 ? getSessionTreeSidecar().load(sessionId) : void 0;
  let tree = existing === void 0 ? restored ?? new SessionTree(sessionId) : new SessionTree(sessionId, existing.snapshot());
  const actualLatestSeq = agent.session.events.at(-1)?.seq ?? -1;
  tree.limitSessionEventSeq(actualLatestSeq);
  const lastSeq = tree.lastSessionEventSeq();
  const freshEvents = agent.session.events.filter((event) => event.seq > lastSeq);
  let nativeParentId = tree.cursor;
  for (const event of freshEvents) {
    if (event.type === "session-tree/snapshot") {
      if (event.data.snapshot.sessionId !== sessionId) throw new Error("INVALID_SNAPSHOT: snapshot session does not match the owning Session");
      try {
        tree = new SessionTree(sessionId, event.data.snapshot);
      } catch (error) {
        throw new Error(`INVALID_SNAPSHOT: ${error instanceof Error ? error.message : "invalid snapshot"}`);
      }
      tree.markSessionEventSeq(event.seq);
      nativeParentId = tree.cursor;
      continue;
    }
    if (event.type === "session-tree/cursor") {
      const moved = tree.jump(event.data.nodeId);
      if (!moved.ok) throw new Error(`${moved.error.code}: ${moved.error.message}`);
      nativeParentId = event.data.nodeId;
      continue;
    }
    if (event.type === "session-tree/branch") {
      const branched = tree.branch(event.data.nodeId, event.data.branch);
      if (!branched.ok) throw new Error(`${branched.error.code}: ${branched.error.message}`);
      nativeParentId = event.data.nodeId;
      continue;
    }
    if (event.type === "session-tree/selection") {
      const selected = tree.select(event.data.nodeId);
      if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
      continue;
    }
    const isExplicitTreeNode = event.type === "session-tree/node";
    const isTreeMetadataEvent = event.type === "tool/call" || event.type === "request/context";
    if (!isExplicitTreeNode && !isTreeMetadataEvent && !isSurfaceEvent(event)) continue;
    const nodes = sessionEventsToTreeNodes([event], nativeParentId);
    if (nodes.length === 0) continue;
    const first = nodes[0];
    if (first === void 0) continue;
    const projected = isExplicitTreeNode ? first : { ...first, branch: tree.activeBranch };
    const restored2 = tree.replay([{ seq: tree.list().length, node: projected }]);
    if (!restored2.ok) throw new Error(`${restored2.error.code}: ${restored2.error.message}`);
    nativeParentId = projected.nodeId;
  }
  const newestSeq = freshEvents[freshEvents.length - 1]?.seq;
  if (newestSeq !== void 0) tree.markSessionEventSeq(newestSeq);
  sessionTreeStore.replace(sessionId, tree);
  applyTreeCursorToSession(agent, tree);
  persistSessionTree(tree);
  return tree;
}
function selectedSurfaceSeqs(tree, session) {
  const seqs = [];
  for (const node of tree.currentPath()) {
    const seq = node.metadata?.sessionEventSeq;
    if (typeof seq !== "number") continue;
    const event = session.events[seq];
    if (event !== void 0 && isSurfaceEvent(event)) seqs.push(seq);
  }
  return seqs;
}
function appendStockCursorEvent(session, tree, currentNodes) {
  if (currentNodes.length === 0) return void 0;
  const context = session.requestContext();
  const marker = { kind: "cursor", nodeId: tree.cursor };
  const data = {
    turn: 0,
    step: 0,
    message: {
      role: "assistant",
      content: [],
      id: `session-tree-cursor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source: {
        kind: "model",
        provider: context?.provider ?? "session-tree",
        model: context?.model ?? "cursor"
      }
    },
    treeRestore: marker
  };
  return session.append("assistant/message", data, {
    surfaceOp: { op: "replace", start: currentNodes[0], end: currentNodes[currentNodes.length - 1] },
    sourceEventSeqs: [...currentNodes]
  });
}
function setStockSurfaceNodes(session, seqs) {
  const nodes = session.surface.nodes;
  if (!Array.isArray(nodes) || Object.isFrozen(nodes)) {
    throw new Error("stock Harness message surface is not writable in this revision");
  }
  nodes.splice(0, nodes.length, ...seqs);
}
function sameSurfaceNodes(left, right) {
  return left.length === right.length && left.every((seq, index) => seq === right[index]);
}
function normalizeSurfaceNodeSeqs(values) {
  const seqs = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (Number.isSafeInteger(child)) seqs.push(child);
      }
    } else if (Number.isSafeInteger(value)) {
      seqs.push(value);
    }
  }
  return seqs;
}
function applyTreeCursorToSession(agent, tree) {
  const session = agent.session;
  const seqs = selectedSurfaceSeqs(tree, session);
  if (supportsSelectedMessageSurface(session)) {
    session.selectMessageSurface(seqs);
    return;
  }
  const stockSession = session;
  const currentNodes = normalizeSurfaceNodeSeqs(stockSession.surface.nodes);
  if (sameSurfaceNodes(currentNodes, seqs)) return;
  if (process.env.DSH_SESSION_TREE_DEBUG === "1") {
    console.error("[session-tree] stock surface rewrite", { sessionId: stockSession.id, currentNodes, seqs, cursor: tree.cursor });
  }
  const event = appendStockCursorEvent(stockSession, tree, currentNodes);
  if (event !== void 0) tree.markSessionEventSeq(event.seq);
  setStockSurfaceNodes(stockSession, seqs);
  persistSessionTree(tree);
}
var _session_dec, _fork_dec, _jump_dec, _list_dec, _a, _init;
var SessionTreeService = class extends (_a = TypertRemoteService, _list_dec = [Remote("list")], _jump_dec = [Remote("jump")], _fork_dec = [Remote("fork")], _session_dec = [Remote("session")], _a) {
  /**
   * Register the service under `sessionTree`.
   * @param ctx - owning Cordis Context.
   */
  constructor(ctx) {
    super(ctx, "sessionTree");
    __runInitializers(_init, 5, this);
    ctx.on("agent/pre-step", ({ agent }, next) => {
      syncSessionTree(agent);
      return next();
    });
    ctx.on("session/flush", (session) => {
      const tree = sessionTreeStore.get(session.id);
      if (tree !== void 0) persistSessionTree(tree);
    });
  }
  list(agent) {
    return this.synced(agent).view();
  }
  /** Synchronize native history, falling back to the last committed tree when replay fails. */
  synced(agent) {
    try {
      return syncSessionTree(agent);
    } catch {
      const committed = sessionTreeStore.require(agent.session.id);
      if (!committed.ok) throw new Error(`${committed.error.code}: ${committed.error.message}`);
      return committed.value;
    }
  }
  jump(agent, nodeId2) {
    const tree = syncSessionTree(agent);
    const checkpoint = tree.checkpoint();
    const result = tree.jump(nodeId2);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    try {
      const event = appendSessionTreeEvent(agent.session, "session-tree/cursor", { nodeId: nodeId2 });
      if (event !== void 0) tree.markSessionEventSeq(event.seq);
      if (nodeId2 !== null) {
        const selected = tree.select(nodeId2);
        if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
        const selection = appendSessionTreeEvent(agent.session, "session-tree/selection", { nodeId: nodeId2 });
        if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
      }
      applyTreeCursorToSession(agent, tree);
    } catch (error) {
      tree.rollback(checkpoint);
      throw error;
    }
    return result.value;
  }
  fork(agent, nodeId2, branch) {
    const branchName = branch === "" ? "fork" : branch;
    const tree = syncSessionTree(agent);
    const checkpoint = tree.checkpoint();
    const result = tree.fork(nodeId2, branchName);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    try {
      const selected = tree.select(nodeId2);
      if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
      const event = appendSessionTreeEvent(agent.session, "session-tree/branch", { nodeId: nodeId2, branch: result.value.branch });
      if (event !== void 0) tree.markSessionEventSeq(event.seq);
      const selection = appendSessionTreeEvent(agent.session, "session-tree/selection", { nodeId: nodeId2 });
      if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
      applyTreeCursorToSession(agent, tree);
    } catch (error) {
      tree.rollback(checkpoint);
      throw error;
    }
    return result.value;
  }
  session(agent) {
    return this.synced(agent).info();
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "list", _list_dec, SessionTreeService);
__decorateElement(_init, 1, "jump", _jump_dec, SessionTreeService);
__decorateElement(_init, 1, "fork", _fork_dec, SessionTreeService);
__decorateElement(_init, 1, "session", _session_dec, SessionTreeService);
__decoratorMetadata(_init, SessionTreeService);
var src_default = SessionTreeService;

// packages/extensions/tool-session-tree/src/index.ts
var src_exports = {};
__export(src_exports, {
  SESSION_TREE_PROMPT: () => SESSION_TREE_PROMPT,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
import { SessionId as toSessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
var name = "tool-session-tree";
var inject = ["tools", "systemPrompt", "commands", "agents"];
var SESSION_TREE_PROMPT = "SessionTree is the append-only projection of this agent's durable Harness Session log. Native user, assistant, tool, and model-context events are synchronized automatically: never duplicate ordinary turns with operation 'append'. Before answering after navigation, call session_tree with operation 'context' and treat its root-to-cursor messages as the active branch context. Use 'append' only for an explicit custom tree entry not already recorded by Harness. To explore an alternative, call 'fork' or 'branch' with a historical nodeId and branch name (or 'branch.summary' to record a summary); old nodes are never modified or deleted. Use 'branches' and 'tree' to inspect topology, and 'snapshot.save'/'snapshot.load' for explicit export or full-tree restore. All operations report failures as {ok:false,error:{code,message}}.";
function apply(ctx) {
  ctx.systemPrompt.section({ name: "plugin:pi_agent_session_tree", order: 120, text: SESSION_TREE_PROMPT });
  ctx.tools.register(defineTool({
    name: "session_tree",
    description: "Inspect and navigate the append-only tree projected from the durable Harness Session log. Native user/assistant/tool/model events synchronize automatically; use append only for an explicit custom entry, context to read the active cursor path, fork or branch from a historical node without deleting old history, clone the active path into an independent Harness session, and snapshot.save/snapshot.load for explicit export or restore.",
    parameters: {
      operation: { type: "string", required: true },
      sessionId: { type: "string" },
      nodeId: { type: "string" },
      branch: { type: "string" },
      summary: { type: "string" },
      message: { type: "json" },
      snapshot: { type: "json" },
      metadata: { type: "json" },
      targetSessionId: { type: "string" },
      content: { type: "json" },
      model: { type: "string" },
      usage: { type: "json" },
      cost: { type: "number" },
      error: { type: "string" }
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
    },
    async execute(args, exec) {
      try {
        return await runToolOperation(ctx, args, exec);
      } catch (error) {
        return {
          ok: false,
          error: { code: "INVALID_ARGUMENT", message: error instanceof Error ? error.message : "invalid request" }
        };
      }
    }
  }));
  ctx.commands.register({
    name: "tree",
    description: "Open or refresh the right-sidebar session tree",
    handler: (invocation) => runTreeCommand(ctx, invocation)
  });
  ctx.commands.register({ name: "fork", description: "Fork the selected session-tree node", handler: (invocation) => runForkCommand(invocation) });
  ctx.commands.register({ name: "clone", description: "Clone the selected session-tree node into a new Harness session", handler: (invocation) => runCloneCommand(ctx, invocation) });
  ctx.commands.register({ name: "session", description: "Show current session tree status", handler: (invocation) => runSessionCommand(invocation) });
}
async function runToolOperation(ctx, args, exec) {
  if (exec.agent === void 0) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "session_tree requires an agent-backed session" } };
  }
  const sessionId = args.sessionId ?? exec.agent.session.id;
  const isOwnSession = sessionId === exec.agent.session.id;
  if (isOwnSession) syncSessionTree(exec.agent);
  if (args.operation !== "sessions" && args.operation !== "clone" && !isOwnSession) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "session_tree can only modify the calling agent session" } };
  }
  if (args.operation === "clone" && args.targetSessionId === void 0) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "targetSessionId is required" } };
  }
  switch (args.operation) {
    case "create": {
      const tree2 = sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId);
      return { ok: true, value: { sessionId: tree2.sessionId } };
    }
    case "sessions":
      return { ok: true, value: sessionTreeStore.list() };
    case "clone": {
      if (args.targetSessionId === void 0) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "targetSessionId is required" } };
      if (sessionId !== exec.agent.session.id) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "clone must target the calling agent session" } };
      return cloneActiveSession(ctx, exec.agent, args.targetSessionId);
    }
    case "snapshot.load": {
      if (args.snapshot === void 0) {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "snapshot is required" } };
      }
      const snapshot = args.snapshot;
      if (snapshot.sessionId !== sessionId) {
        return { ok: false, error: { code: "INVALID_SNAPSHOT", message: `snapshot session '${snapshot.sessionId}' does not match the calling session '${sessionId}'` } };
      }
      if (sessionId !== exec.agent.session.id) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "snapshot.load requires the calling agent session" } };
      const candidate = newSessionTreeFromSnapshot(sessionId, snapshot);
      if (!candidate.ok) return { ok: false, error: { code: "INVALID_SNAPSHOT", message: candidate.error } };
      const event = appendSessionTreeEvent(exec.agent.session, "session-tree/snapshot", { snapshot });
      if (event !== void 0) candidate.value.markSessionEventSeq(event.seq);
      sessionTreeStore.replace(sessionId, candidate.value);
      applyTreeCursorToSession(exec.agent, candidate.value);
      persistSessionTree(candidate.value);
      return { ok: true, value: { sessionId } };
    }
    default:
      break;
  }
  const required = sessionTreeStore.require(sessionId);
  if (!required.ok) return required;
  const tree = required.value;
  switch (args.operation) {
    case "append": {
      if (args.message === void 0) {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "message is required" } };
      }
      const request = args.message;
      if (typeof request.role !== "string" || typeof request.content !== "string") {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "message.role and message.content are required" } };
      }
      const checkpoint = tree.checkpoint();
      const appended = tree.append(
        {
          role: request.role,
          content: request.content,
          ...request.name === void 0 ? {} : { name: request.name },
          ...request.toolCallId === void 0 ? {} : { toolCallId: request.toolCallId }
        },
        {
          ...args.branch === void 0 ? {} : { branch: args.branch },
          ...args.summary === void 0 ? {} : { summary: args.summary },
          ...args.metadata === void 0 ? {} : { metadata: args.metadata },
          ...args.content === void 0 ? {} : { content: args.content },
          ...args.model === void 0 ? {} : { model: args.model },
          ...args.usage === void 0 ? {} : { usage: args.usage },
          ...args.cost === void 0 ? {} : { cost: args.cost },
          ...args.error === void 0 ? {} : { error: args.error }
        }
      );
      if (appended.ok && sessionId === exec.agent.session.id) {
        try {
          const event = appendSessionTreeEvent(exec.agent.session, "session-tree/node", { node: appended.value });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          persistSessionTree(tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return appended;
    }
    case "list":
      return { ok: true, value: tree.list() };
    case "branches":
      return { ok: true, value: tree.branches() };
    case "tree":
      return { ok: true, value: tree.view() };
    case "session":
      return { ok: true, value: tree.info() };
    case "jump": {
      const checkpoint = tree.checkpoint();
      const moved = tree.jump(args.nodeId ?? null);
      if (moved.ok && sessionId === exec.agent.session.id) {
        try {
          const event = appendSessionTreeEvent(exec.agent.session, "session-tree/cursor", { nodeId: args.nodeId ?? null });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          if (args.nodeId != null) {
            const selected = tree.select(args.nodeId);
            if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
            const selection = appendSessionTreeEvent(exec.agent.session, "session-tree/selection", { nodeId: args.nodeId });
            if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          }
          applyTreeCursorToSession(exec.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return moved;
    }
    case "fork": {
      if (args.nodeId === void 0) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "nodeId is required" } };
      const checkpoint = tree.checkpoint();
      const forked = tree.fork(args.nodeId, args.branch);
      if (forked.ok && sessionId === exec.agent.session.id) {
        try {
          const selected = tree.select(args.nodeId);
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
          const event = appendSessionTreeEvent(exec.agent.session, "session-tree/branch", { nodeId: args.nodeId, branch: forked.value.branch });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          const selection = appendSessionTreeEvent(exec.agent.session, "session-tree/selection", { nodeId: args.nodeId });
          if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          applyTreeCursorToSession(exec.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return forked;
    }
    case "context":
      return { ok: true, value: { cursor: tree.cursor, messages: tree.messages(args.nodeId ?? tree.cursor) } };
    case "branch": {
      if (args.nodeId === void 0 || args.branch === void 0) {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "nodeId and branch are required" } };
      }
      const checkpoint = tree.checkpoint();
      const branched = tree.branch(args.nodeId, args.branch);
      if (branched.ok && sessionId === exec.agent.session.id) {
        try {
          const selected = tree.select(args.nodeId);
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
          const event = appendSessionTreeEvent(exec.agent.session, "session-tree/branch", { nodeId: args.nodeId, branch: args.branch });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          const selection = appendSessionTreeEvent(exec.agent.session, "session-tree/selection", { nodeId: args.nodeId });
          if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          applyTreeCursorToSession(exec.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return branched;
    }
    case "branch.summary": {
      if (args.nodeId === void 0 || args.summary === void 0) {
        return { ok: false, error: { code: "INVALID_ARGUMENT", message: "nodeId and summary are required" } };
      }
      const checkpoint = tree.checkpoint();
      const summarized = tree.branchWithSummary(args.nodeId, args.summary);
      if (summarized.ok && sessionId === exec.agent.session.id) {
        try {
          const event = appendSessionTreeEvent(exec.agent.session, "session-tree/node", { node: summarized.value });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          applyTreeCursorToSession(exec.agent, tree);
          persistSessionTree(tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return summarized;
    }
    case "snapshot.save":
      return { ok: true, value: tree.snapshot() };
    default:
      return { ok: false, error: { code: "INVALID_ARGUMENT", message: `unknown operation '${args.operation}'` } };
  }
}
function runForkCommand(invocation) {
  const [branch = `fork-${Date.now().toString(36)}`] = invocation.rawInput.trim().split(/\s+/u).filter(Boolean);
  const tree = syncSessionTree(invocation.agent);
  if (tree.selectedNode === null) return errorCommand("\u8BF7\u5148\u5728\u53F3\u4FA7\u4F1A\u8BDD\u6811\u9009\u4E2D\u76EE\u6807\u8282\u70B9");
  const checkpoint = tree.checkpoint();
  const forked = tree.fork(tree.selectedNode, branch);
  if (!forked.ok) return jsonCommand(forked);
  try {
    const selected = tree.select(forked.value.cursor);
    if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
    const event = appendSessionTreeEvent(invocation.agent.session, "session-tree/branch", { nodeId: forked.value.cursor, branch: forked.value.branch });
    if (event !== void 0) tree.markSessionEventSeq(event.seq);
    const selection = appendSessionTreeEvent(invocation.agent.session, "session-tree/selection", { nodeId: forked.value.cursor });
    if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
    applyTreeCursorToSession(invocation.agent, tree);
  } catch (error) {
    tree.rollback(checkpoint);
    throw error;
  }
  return jsonCommand(forked);
}
async function cloneActiveSession(ctx, agent, target, nodeId2) {
  const tree = syncSessionTree(agent);
  const focusId = nodeId2 ?? tree.cursor;
  const seed = agent.session.events.map((event, index) => {
    const record = JSON.parse(JSON.stringify(event));
    if (record.type === "session-tree/snapshot") {
      record.data = { ...record.data, snapshot: { ...record.data.snapshot, sessionId: toSessionId(target) } };
    }
    record.seq = index;
    return record;
  });
  const seedTime = Date.now();
  if (supportsDurableSessionTreeEvents(agent.session)) {
    seed.push({
      type: "session-tree/cursor",
      seq: seed.length,
      time: seedTime + seed.length,
      data: { nodeId: focusId }
    });
    if (focusId !== null) {
      seed.push({
        type: "session-tree/selection",
        seq: seed.length,
        time: seedTime + seed.length,
        data: { nodeId: focusId }
      });
    }
  }
  seedCloneTree(toSessionId(target), tree, focusId, seed.length - 1);
  try {
    await ctx.agents.create({
      sessionId: toSessionId(target),
      seed,
      meta: { parentSession: agent.session.id, seedLength: seed.length },
      agentOptions: agent.options
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no agent factory registered")) {
      throw error;
    }
  }
  return { ok: true, value: { sessionId: target } };
}
function seedCloneTree(targetId, source, focusId, nativeEventSeq) {
  const snapshot = source.snapshot();
  const focusNode = focusId === null ? void 0 : snapshot.nodes.find((node) => node.nodeId === focusId);
  const activeBranch = focusNode?.branch ?? snapshot.activeBranch;
  const branchHeads = { ...snapshot.branchHeads };
  if (focusNode !== void 0) branchHeads[focusNode.branch] = focusNode.nodeId;
  const clonedTree = new SessionTree(targetId, {
    version: 1,
    sessionId: targetId,
    cursor: focusId,
    activeBranch,
    ...focusId === null && Object.keys(branchHeads).length === 0 ? {} : { branchHeads },
    selectedNodeId: focusId,
    nativeEventSeq,
    nodes: snapshot.nodes
  });
  sessionTreeStore.replace(targetId, clonedTree);
  persistSessionTree(clonedTree);
}
function newSessionTreeFromSnapshot(sessionId, snapshot) {
  try {
    return { ok: true, value: new SessionTree(sessionId, snapshot) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid snapshot" };
  }
}
async function runCloneCommand(ctx, invocation) {
  const tree = syncSessionTree(invocation.agent);
  if (tree.selectedNode === null) return errorCommand("\u8BF7\u5148\u5728\u53F3\u4FA7\u4F1A\u8BDD\u6811\u9009\u4E2D\u76EE\u6807\u8282\u70B9");
  const target = `${invocation.agent.session.id}-clone-${Date.now().toString(36)}`;
  try {
    return jsonCommand(await cloneActiveSession(ctx, invocation.agent, target, tree.selectedNode));
  } catch (error) {
    return { kind: "error", text: JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT", message: error instanceof Error ? error.message : "clone failed" } }) };
  }
}
function runSessionCommand(invocation) {
  return jsonCommand({ ok: true, value: syncSessionTree(invocation.agent).info() });
}
function jsonCommand(value, map) {
  const result = map === void 0 ? value : value.ok ? map(value.value) : value;
  const failed = typeof result === "object" && result !== null && result.ok === false;
  return { kind: failed ? "error" : "success", text: JSON.stringify(result) };
}
function errorCommand(message) {
  return { kind: "error", text: JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT", message } }) };
}
async function runTreeCommand(ctx, invocation) {
  const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean);
  const sessionId = invocation.agent.session.id;
  const tree = syncSessionTree(invocation.agent);
  const [head, ...rest] = parts;
  const action = head === "snapshot" ? `snapshot.${rest[0] ?? ""}` : head ?? "list";
  const json = (value) => {
    const failed = typeof value === "object" && value !== null && value.ok === false;
    return { kind: failed ? "error" : "success", text: JSON.stringify(value) };
  };
  switch (action) {
    case "list":
      return json({ ok: true, value: tree.list() });
    case "branches":
      return json({ ok: true, value: tree.branches() });
    case "tree":
      return json({ ok: true, value: tree.view() });
    case "session":
      return json({ ok: true, value: tree.info() });
    case "fork": {
      if (tree.selectedNode === null) return json({ ok: false, error: { code: "INVALID_ARGUMENT", message: "\u8BF7\u5148\u5728\u53F3\u4FA7\u4F1A\u8BDD\u6811\u9009\u4E2D\u76EE\u6807\u8282\u70B9" } });
      const checkpoint = tree.checkpoint();
      const result = tree.fork(tree.selectedNode, rest[0] ?? "fork");
      if (result.ok) {
        try {
          const selected = tree.select(result.value.cursor);
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
          const event = appendSessionTreeEvent(invocation.agent.session, "session-tree/branch", { nodeId: result.value.cursor, branch: result.value.branch });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          const selection = appendSessionTreeEvent(invocation.agent.session, "session-tree/selection", { nodeId: result.value.cursor });
          if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          applyTreeCursorToSession(invocation.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return json(result);
    }
    case "clone": {
      if (tree.selectedNode === null) return json({ ok: false, error: { code: "INVALID_ARGUMENT", message: "\u8BF7\u5148\u5728\u53F3\u4FA7\u4F1A\u8BDD\u6811\u9009\u4E2D\u76EE\u6807\u8282\u70B9" } });
      const target = rest[0] ?? `${sessionId}-clone-${Date.now().toString(36)}`;
      try {
        return json(await cloneActiveSession(ctx, invocation.agent, target, tree.selectedNode));
      } catch (error) {
        return json({ ok: false, error: { code: "INVALID_ARGUMENT", message: error instanceof Error ? error.message : "clone failed" } });
      }
    }
    case "context":
      return json({ ok: true, value: { cursor: tree.cursor, selectedNodeId: tree.selectedNode, messages: tree.messages(tree.selectedNode ?? tree.cursor) } });
    case "jump": {
      const nodeId2 = rest[0] ?? tree.selectedNode;
      if (nodeId2 === null) return json({ ok: false, error: { code: "INVALID_ARGUMENT", message: "\u8BF7\u5148\u5728\u53F3\u4FA7\u4F1A\u8BDD\u6811\u9009\u4E2D\u76EE\u6807\u8282\u70B9" } });
      const checkpoint = tree.checkpoint();
      const result = tree.jump(nodeId2);
      if (result.ok) {
        try {
          const event = appendSessionTreeEvent(invocation.agent.session, "session-tree/cursor", { nodeId: nodeId2 });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          const selected = tree.select(nodeId2);
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
          const selection = appendSessionTreeEvent(invocation.agent.session, "session-tree/selection", { nodeId: nodeId2 });
          if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          applyTreeCursorToSession(invocation.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return json(result);
    }
    case "branch": {
      const nodeId2 = tree.selectedNode ?? "";
      const branch = rest[0] ?? "fork";
      const checkpoint = tree.checkpoint();
      const result = tree.branch(nodeId2, branch);
      if (result.ok) {
        try {
          const selected = tree.select(nodeId2);
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`);
          const event = appendSessionTreeEvent(invocation.agent.session, "session-tree/branch", { nodeId: nodeId2, branch });
          if (event !== void 0) tree.markSessionEventSeq(event.seq);
          const selection = appendSessionTreeEvent(invocation.agent.session, "session-tree/selection", { nodeId: nodeId2 });
          if (selection !== void 0) tree.markSessionEventSeq(selection.seq);
          applyTreeCursorToSession(invocation.agent, tree);
        } catch (error) {
          tree.rollback(checkpoint);
          throw error;
        }
      }
      return json(result);
    }
    case "snapshot.save":
      return json({ ok: true, value: tree.snapshot() });
    case "snapshot.load": {
      const raw = rest.slice(1).join(" ").trim();
      if (raw === "") {
        return { kind: "error", text: JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT", message: "snapshot JSON is required" } }) };
      }
      try {
        const snapshot = JSON.parse(raw);
        if (snapshot.sessionId !== sessionId) {
          return json({ ok: false, error: { code: "INVALID_SNAPSHOT", message: `snapshot session '${snapshot.sessionId}' does not match the calling session '${sessionId}'` } });
        }
        const candidate = new SessionTree(sessionId, snapshot);
        try {
          const event = appendSessionTreeEvent(invocation.agent.session, "session-tree/snapshot", { snapshot });
          if (event !== void 0) candidate.markSessionEventSeq(event.seq);
          sessionTreeStore.replace(sessionId, candidate);
          applyTreeCursorToSession(invocation.agent, candidate);
          persistSessionTree(candidate);
          return json({ ok: true, value: { sessionId } });
        } catch (error) {
          throw error;
        }
      } catch (error) {
        return { kind: "error", text: JSON.stringify({ ok: false, error: { code: "INVALID_SNAPSHOT", message: error instanceof Error ? error.message : "invalid snapshot JSON" } }) };
      }
    }
    default:
      return {
        kind: "error",
        text: JSON.stringify({
          ok: false,
          error: {
            code: "INVALID_ARGUMENT",
            message: "Usage: /tree [list|branches|tree|context|jump <nodeId>|branch <nodeId> <name>|snapshot save|snapshot load <json>]"
          }
        })
      };
  }
}

// src/host.ts
var name2 = "session-tree";
var inject2 = ["tools", "systemPrompt", "commands", "agents"];
function apply2(ctx) {
  ctx.plugin(src_default);
  ctx.plugin(src_exports);
}
export {
  apply2 as apply,
  inject2 as inject,
  name2 as name
};
