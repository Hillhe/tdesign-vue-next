import {
  CHAT_CONTENT_TYPES,
  AGENT_SCOPE_MESSAGE_ROLES,
  isAgentScopeCallMessageType,
  isAgentScopeCallOutputMessageType,
  isAgentScopeCallStartMessageType,
  AGENT_SCOPE_THINKING_MESSAGE_TYPES,
  AGENT_SCOPE_TEXT_MESSAGE_TYPES,
  DEFAULT_ERROR_STATUS,
  createStateFingerprint,
  getAgentScopeContentKey,
  getAgentScopeEventId,
  getAgentScopeToolCallId,
  getContentKeys,
  getMessageText,
  isAgentScopeTerminalStatus,
  mapContentItemToChatContent,
  normalizeAgentScopeStatus,
  safeJsonParse,
} from './common.js';

const messageState = new Map();
const toolState = new Map();
const seenEventKeys = new Set();
const emittedFinalState = new Map();
const activeThinkingIds = new Set();
const activeMarkdownIds = new Set();

function normalizeChunk(chunk) {
  const input = typeof chunk === 'string' ? chunk : chunk?.data || chunk;
  const rawText = typeof input === 'string' ? input.replace(/^data:\s*/, '') : input;
  const raw = safeJsonParse(rawText);
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

function isTerminalStatus(status) {
  return isAgentScopeTerminalStatus(status) || status === 'rejected';
}

function mapChatStatus(status) {
  return normalizeAgentScopeStatus(status === 'rejected' ? DEFAULT_ERROR_STATUS : status);
}

function createMessageState(payload, defaults = {}) {
  return {
    id: getAgentScopeEventId(payload),
    role: payload.role || 'assistant',
    type: payload.type || 'message',
    status: payload.status || 'in_progress',
    text: '',
    finalText: '',
    ...defaults,
  };
}

function mergeMessageState(payload, key = getAgentScopeEventId(payload), defaults = {}) {
  const prev = messageState.get(key) || createMessageState(payload, defaults);

  prev.role = payload.role || prev.role;
  prev.type = payload.type || prev.type;
  prev.status = payload.status || prev.status;

  const text = getMessageText(payload);
  if (text) {
    prev.finalText = text;
    prev.text = text;
  }

  messageState.set(key, prev);
  return prev;
}

function mergeTextState(payload) {
  return mergeMessageState(payload);
}

function getThinkingStateKey(payload) {
  return `think:${getAgentScopeEventId(payload)}`;
}

function mergeThinkingState(payload) {
  const key = getThinkingStateKey(payload);
  const prev = messageState.get(key) || createMessageState(payload, { type: payload.type || 'reasoning', chunks: [] });

  prev.role = payload.role || prev.role;
  prev.type = payload.type || prev.type;
  prev.status = payload.status || prev.status;

  const text = getMessageText(payload);
  if (payload.delta && text) {
    prev.chunks = Array.isArray(prev.chunks) ? prev.chunks : [];
    prev.chunks.push(text);
    prev.text = text;
    activeThinkingIds.add(key);
  }

  if (!payload.delta && text && isTerminalStatus(payload.status)) {
    prev.finalText = text;
    prev.text = text;
    activeThinkingIds.delete(key);
  }

  messageState.set(key, prev);
  return prev;
}

function parseToolOutputResult(output) {
  const raw = output?.output || '';
  if (!raw) return { output: '' };

  if (typeof raw !== 'string') return { output: raw };

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const image = parsed.find((item) => item?.type === 'image' && item?.source?.url);
      const text = parsed.find((item) => item?.type === 'text' && typeof item?.text === 'string');
      if (image?.source?.url) {
        return { output: raw, imageUrl: image.source.url, text: text?.text || '' };
      }
      if (text?.text) {
        return { output: raw, text: text.text };
      }
    }
    return { output: raw };
  } catch {
    return { output: raw };
  }
}

function createChunkFingerprint(contentKey, type, text, status, strategy) {
  return `${contentKey}:${type}:${text}:${status}:${strategy}`;
}

function shouldSkipEmitting(contentKey, fingerprint) {
  return !!contentKey && emittedFinalState.get(contentKey) === fingerprint;
}

function markChunkEmitted(contentKey, fingerprint, status) {
  if (contentKey && status === 'complete') emittedFinalState.set(contentKey, fingerprint);
}

function getToolStateKeys(payload) {
  const callId = getAgentScopeToolCallId(payload);
  const msgId = payload?.msg_id || payload?.id || '';
  return { callId, msgId, keys: [callId, msgId].filter(Boolean) };
}

function isToolCallStart(payload) {
  return isAgentScopeCallStartMessageType(payload.type);
}

function isToolCallOutput(payload) {
  return isAgentScopeCallOutputMessageType(payload.type);
}

function mergeToolState(payload) {
  const { callId, msgId, keys } = getToolStateKeys(payload);
  if (!keys.length) return null;

  const prev = keys.map((key) => toolState.get(key)).find(Boolean) || {
    callId: callId || msgId,
    input: null,
    output: null,
    status: payload.status || 'in_progress',
    inputMsgId: null,
    outputMsgId: null,
    signature: '',
    emitted: false,
  };

  prev.status = payload.status || prev.status;

  const { input, output } = getContentKeys(payload);

  if (isToolCallStart(payload) || !isToolCallOutput(payload)) {
    prev.inputMsgId = payload.id || payload.msg_id || prev.inputMsgId;
    prev.input = {
      call_id: input.call_id || keys[0],
      name: input.name || payload.name || payload.type || 'tool',
      arguments: input.arguments || payload.arguments || prev.input?.arguments || prev.lastArgs || '',
    };
    prev.args = prev.input.arguments;
  }

  if (isToolCallOutput(payload)) {
    prev.outputMsgId = payload.id || payload.msg_id || prev.outputMsgId;
    if (!prev.input) {
      prev.input = {
        call_id: input.call_id || keys[0],
        name: input.name || payload.name || payload.type || 'tool',
        arguments: prev.args || input.arguments || payload.arguments || '',
      };
    }
    prev.output = {
      call_id: output.call_id || input.call_id || keys[0],
      name: output.name || input.name || payload.name || payload.type || 'tool',
      ...parseToolOutputResult(output),
    };
  }

  prev.signature = JSON.stringify({
    inputMsgId: prev.inputMsgId,
    outputMsgId: prev.outputMsgId,
    input: prev.input,
    output: prev.output,
    status: prev.status,
  });

  for (const key of keys.concat([prev.input?.call_id, prev.output?.call_id]).filter(Boolean)) {
    toolState.set(key, prev);
  }
  return prev;
}

function handleContentText(payload, content, contentKey) {
  const text = content.text || '';
  const thinkingKey = getThinkingStateKey({ msg_id: content.msg_id || payload.msg_id || payload.id });
  const isThinkingEvent = AGENT_SCOPE_THINKING_MESSAGE_TYPES.has(payload.type) || activeThinkingIds.has(thinkingKey);

  if (isThinkingEvent) {
    return handleThinkingContent(payload, content, contentKey, thinkingKey, text);
  }

  return handleMarkdownContent(payload, content, contentKey, text);
}

function handleThinkingContent(payload, content, contentKey, thinkingKey, text) {
  const isFirstThinkingChunk = !activeThinkingIds.has(thinkingKey);
  const mergedThinking = mergeThinkingState({
    ...content,
    role: 'assistant',
    type: 'reasoning',
    status: content.status || payload.status,
  });

  if (content.delta) {
    activeThinkingIds.add(thinkingKey);
    return toThinkingChunk(text, mergedThinking.status, contentKey, isFirstThinkingChunk ? 'append' : 'merge');
  }

  if (isTerminalStatus(content.status || payload.status)) {
    activeThinkingIds.delete(thinkingKey);
    return {
      type: CHAT_CONTENT_TYPES.thinking,
      data: {
        text: '',
        title: '思考完成',
      },
      status: 'complete',
      strategy: 'merge',
    };
  }

  return null;
}

function handleMarkdownContent(payload, content, contentKey, text) {
  const contentStatus = content.status || payload.status;
  mergeTextState({
    ...content,
    role: 'assistant',
    type: 'message',
    id: content.msg_id || content.id || payload.id || payload.msg_id,
  });
  if (!content.delta) return null;
  const isFirstMarkdownChunk = !activeMarkdownIds.has(contentKey);
  activeMarkdownIds.add(contentKey);
  return toMarkdownChunk(text, contentStatus, contentKey, isFirstMarkdownChunk ? 'append' : 'merge');
}

function handleContentMedia(payload, content) {
  const mapped = mapContentItemToChatContent(content, content.msg_id || content.id || '');
  if (!mapped) return null;
  return { ...mapped, status: mapChatStatus(content.status || payload.status), strategy: 'append' };
}

function handleMessageTool(payload) {
  const merged = mergeToolState(payload);
  if (!merged) return null;
  if (isToolCallOutput(payload) && merged.output?.imageUrl) {
    return {
      id: merged.callId,
      type: CHAT_CONTENT_TYPES.imageview,
      data: [{ url: merged.output.imageUrl }],
      status: mapChatStatus(merged.status),
      strategy: 'append',
    };
  }
  const isStart = isToolCallStart(payload);
  const strategy = merged.emitted || !isStart ? 'merge' : 'append';
  return {
    id: merged.callId,
    type: CHAT_CONTENT_TYPES.toolcall,
    data: {
      toolCallId: merged.callId,
      toolCallName: (merged.input || {}).name || (merged.output || {}).name || 'tool',
      args: (merged.input || {}).arguments || merged.args || merged.lastArgs || '',
      result: (merged.output || {}).text || (merged.output || {}).output || '',
    },
    status: mapChatStatus(isTerminalStatus(merged.status) ? 'completed' : merged.status),
    strategy,
  };
}

function handleMessageThinking(payload, contentKey) {
  const key = getThinkingStateKey(payload);
  const merged = mergeThinkingState(payload);
  if (isTerminalStatus(payload.status)) {
    activeThinkingIds.delete(key);
    return null;
  }
  if (payload.status === 'in_progress') {
    activeThinkingIds.add(key);
    return toThinkingChunk(merged.text || merged.finalText || '', payload.status, contentKey, 'append');
  }
  if (payload.delta) {
    const isFirstThinkingChunk = !activeThinkingIds.has(key);
    activeThinkingIds.add(key);
    return toThinkingChunk(
      merged.text || merged.finalText || '',
      merged.status,
      contentKey,
      isFirstThinkingChunk ? 'append' : 'merge',
    );
  }
  return null;
}

function handleMessageText(payload, contentKey) {
  if (Array.isArray(payload.content) && payload.content.length > 0) {
    const imageContent = payload.content.find((item) => item?.type === 'image' && item?.image_url);
    if (imageContent) {
      return {
        id: contentKey || payload.id || payload.msg_id || undefined,
        type: CHAT_CONTENT_TYPES.imageview,
        data: [{ url: imageContent.image_url }],
        status: mapChatStatus(payload.status),
      };
    }
    return null;
  }
  const merged = mergeTextState(payload);
  return toMarkdownChunk(merged.text || merged.finalText, merged.status, contentKey);
}

function buildChunk(type, data, status, contentKey, strategy) {
  const finalStatus = mapChatStatus(status);
  const dataKey = typeof data === 'string' ? data : safeJsonParse(JSON.stringify(data)) || data;
  const fingerprint = createChunkFingerprint(
    contentKey,
    type,
    typeof dataKey === 'string' ? dataKey : JSON.stringify(dataKey),
    finalStatus,
    strategy,
  );
  if (shouldSkipEmitting(contentKey, fingerprint)) return null;
  markChunkEmitted(contentKey, fingerprint, finalStatus);
  return { type: CHAT_CONTENT_TYPES[type], data, status: finalStatus, strategy };
}

function toMarkdownChunk(text, status = 'in_progress', contentKey = '', strategy = 'append') {
  if (!text) return null;
  return buildChunk('markdown', text, status, contentKey, strategy);
}

function toThinkingChunk(text = '', status = 'in_progress', contentKey = '', strategy = 'append') {
  return buildChunk(
    'thinking',
    {
      text,
      title: mapChatStatus(status) === 'complete' ? '思考完成' : '思考中',
    },
    status,
    contentKey,
    strategy,
  );
}

export function resetAgentScopeSSETranslateState() {
  messageState.clear();
  toolState.clear();
  seenEventKeys.clear();
  emittedFinalState.clear();
}

/**
 * @param {unknown} chunk
 * @returns {import('@tdesign-vue-next/chat').AIMessageContent | null}
 */
export function fromAgentScopeSSEChunkToChatContent(chunk) {
  const payload = normalizeChunk(chunk);
  if (!payload) return null;

  if (payload.object === 'response') {
    return null;
  }

  const eventKey = createStateFingerprint(
    payload.object,
    payload.type,
    payload.id,
    payload.msg_id,
    payload.sequence_number,
    payload.status,
  );

  if (eventKey && seenEventKeys.has(eventKey)) return null;
  if (eventKey) seenEventKeys.add(eventKey);
  const contentKey = getAgentScopeContentKey(payload);

  if (payload.object === 'content') {
    const content = payload;

    if (content.type === 'text') {
      return handleContentText(payload, content, contentKey);
    }

    if (content.type === 'data') {
      const merged = mergeToolState({ ...payload, data: content.data, content: [content] });
      if (!merged) return null;
      const isStart = isToolCallStart(payload);
      const strategy = merged.emitted || !isStart ? 'merge' : 'append';
      return {
        type: CHAT_CONTENT_TYPES.toolcall,
        data: {
          toolCallId: merged.callId,
          toolCallName: (merged.input || {}).name || (merged.output || {}).name || 'tool',
          args: (merged.input || {}).arguments || merged.args || merged.lastArgs || '',
          result: (merged.output || {}).text || (merged.output || {}).output || '',
        },
        status: mapChatStatus(isTerminalStatus(merged.status) ? 'completed' : merged.status),
        strategy,
      };
    }

    if (
      content.type === 'image' ||
      content.type === 'video' ||
      content.type === 'audio' ||
      content.type === 'file' ||
      content.type === 'refusal'
    ) {
      return handleContentMedia(payload, content);
    }

    return null;
  }

  if (payload.object === 'message') {
    if (isAgentScopeCallMessageType(payload.type)) {
      return handleMessageTool(payload);
    }

    if (AGENT_SCOPE_THINKING_MESSAGE_TYPES.has(payload.type)) {
      return handleMessageThinking(payload, contentKey);
    }

    if (AGENT_SCOPE_TEXT_MESSAGE_TYPES.has(payload.type) || AGENT_SCOPE_MESSAGE_ROLES.has(payload.role)) {
      return handleMessageText(payload, contentKey);
    }

    return null;
  }

  return null;
}
