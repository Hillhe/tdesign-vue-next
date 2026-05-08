export const DEFAULT_STATUS_MAP = {
  created: 'complete',
  in_progress: 'pending',
  completed: 'complete',
  canceled: 'stop',
  failed: 'error',
  rejected: 'error',
  unknown: 'pending',
};

export const CONTENT_TYPES = {
  text: 'text',
  data: 'data',
  image: 'image',
  audio: 'audio',
  video: 'video',
  file: 'file',
};

export const CHAT_CONTENT_TYPES = {
  markdown: 'markdown',
  thinking: 'thinking',
  toolcall: 'tool_call',
  attachment: 'attachment',
  image: 'image',
  imageview: 'imageview',
  video: 'video',
  audio: 'audio',
};

export const COMPLETED_STATUS = 'complete';
export const DEFAULT_STREAM_STATUS = 'streaming';
export const DEFAULT_PENDING_STATUS = 'pending';
export const DEFAULT_ERROR_STATUS = 'error';

export const CHAT_MESSAGE_ROLES = new Set(['user', 'assistant']);
export const AGENT_SCOPE_MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);

export const AGENT_SCOPE_CALL_MESSAGE_TYPES = new Set([
  'plugin_call',
  'plugin_call_output',
  'function_call',
  'function_call_output',
  'component_call',
  'component_call_output',
  'mcp_list_tools',
  'mcp_approval_request',
  'mcp_approval_response',
  'mcp_call',
  'mcp_call_output',
]);

export const AGENT_SCOPE_CALL_START_MESSAGE_TYPES = new Set([
  'plugin_call',
  'function_call',
  'component_call',
  'mcp_list_tools',
  'mcp_approval_request',
  'mcp_call',
]);

export const AGENT_SCOPE_CALL_OUTPUT_MESSAGE_TYPES = new Set([
  'plugin_call_output',
  'function_call_output',
  'component_call_output',
  'mcp_approval_response',
  'mcp_call_output',
]);

export function isAgentScopeCallMessageType(type) {
  return AGENT_SCOPE_CALL_MESSAGE_TYPES.has(type);
}

export function isAgentScopeCallStartMessageType(type) {
  return AGENT_SCOPE_CALL_START_MESSAGE_TYPES.has(type);
}

export function isAgentScopeCallOutputMessageType(type) {
  return AGENT_SCOPE_CALL_OUTPUT_MESSAGE_TYPES.has(type);
}

export const AGENT_SCOPE_THINKING_MESSAGE_TYPES = new Set(['reasoning']);
export const AGENT_SCOPE_TEXT_MESSAGE_TYPES = new Set(['message']);
export const AGENT_SCOPE_STREAM_OBJECT_TYPES = new Set(['response', 'message', 'content']);
export const AGENT_SCOPE_STREAM_CONTENT_TYPES = new Set(['text', 'data', 'image', 'audio', 'video', 'file', 'refusal']);

export function normalizeAgentScopeStatus(status) {
  if (status === 'completed' || status === 'finished') return COMPLETED_STATUS;
  if (status === 'failed' || status === 'canceled') return DEFAULT_ERROR_STATUS;
  return DEFAULT_STREAM_STATUS;
}

export function isAgentScopeTerminalStatus(status) {
  return status === 'completed' || status === 'finished' || status === 'failed' || status === 'canceled';
}

export function getAgentScopeEventId(payload) {
  return payload?.msg_id || payload?.id || payload?.message_id || payload?.sequence_number || '';
}

export function getAgentScopeToolCallId(payload) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const first = content[0] || {};
  const last = content[content.length - 1] || {};
  const input = first?.data || payload?.data || {};
  const output = last?.data || {};

  return (
    input.call_id ||
    input.callId ||
    output.call_id ||
    output.callId ||
    payload?.call_id ||
    payload?.callId ||
    payload?.id ||
    payload?.msg_id ||
    ''
  );
}

export function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getMessageText(payload) {
  return typeof payload?.text === 'string' ? payload.text : typeof payload?.message === 'string' ? payload.message : '';
}

export function getContentArray(payload) {
  return Array.isArray(payload?.content) ? payload.content : [];
}

export function getContentKeys(payload) {
  const content = getContentArray(payload);
  const first = content[0] || {};
  const last = content[content.length - 1] || first;
  return { content, first, last, input: first?.data || payload?.data || {}, output: last?.data || {} };
}

export function getMessageContentSource(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

export function getContentMessageId(item, parentMessageId) {
  return item?.msg_id || parentMessageId || item?.id || '';
}

export function getAgentScopeContentKey(payload) {
  return payload?.msg_id || payload?.id || payload?.sequence_number || '';
}

export function createStateFingerprint(...parts) {
  return parts.filter((part) => part !== '' && part != null).join(':');
}

export function createChatMarkdownContent(text) {
  return { type: CHAT_CONTENT_TYPES.markdown, data: text || '' };
}

export function createChatThinkingContent(text, isComplete = false, includeStatus = false, status = COMPLETED_STATUS) {
  const content = {
    type: CHAT_CONTENT_TYPES.thinking,
    data: {
      text: text || '',
      title: isComplete ? '思考完成' : '思考中',
    },
    collapsed: isComplete,
  };

  if (includeStatus) {
    content.status = status;
  }

  return content;
}

export function createChatToolContent(toolCallId, toolCallName, args, result) {
  return {
    type: CHAT_CONTENT_TYPES.toolcall,
    data: {
      toolCallId,
      toolCallName,
      args,
      result,
    },
  };
}

export function createChatImageViewContent(url, status = COMPLETED_STATUS) {
  return {
    type: CHAT_CONTENT_TYPES.imageview,
    data: [{ url }],
    status,
  };
}

export function mapContentItemToChatContent(item, parentMessageId) {
  if (!item) return null;
  const type = item.type;
  const msgId = getContentMessageId(item, parentMessageId);

  if (type === CONTENT_TYPES.text) {
    return createChatMarkdownContent(item.text || '');
  }
  if (AGENT_SCOPE_THINKING_MESSAGE_TYPES.has(type)) {
    return createChatThinkingContent(item.text || item.refusal || '', item.status === 'completed');
  }
  if (type === CONTENT_TYPES.image && item.image_url) {
    return createChatImageViewContent(
      item.image_url,
      isAgentScopeTerminalStatus(item.status) ? COMPLETED_STATUS : DEFAULT_STREAM_STATUS,
    );
  }
  if (type === CONTENT_TYPES.audio && (item.audio_url || item.data)) {
    return { type: CHAT_CONTENT_TYPES.audio, data: { url: item.audio_url || item.data } };
  }
  if (type === CONTENT_TYPES.video && item.video_url) {
    return { type: CHAT_CONTENT_TYPES.video, data: { url: item.video_url } };
  }
  if (type === CONTENT_TYPES.file && (item.file_url || item.file_name || item.fileName)) {
    return {
      type: CHAT_CONTENT_TYPES.attachment,
      data: [{ fileType: 'txt', name: item.file_name || item.fileName || '', url: item.file_url || '' }],
    };
  }
  if (type === CONTENT_TYPES.data) {
    const payload = item.data || item;
    const output = payload.output || item.output || '';

    try {
      const parsed = typeof output === 'string' ? JSON.parse(output) : output;
      if (Array.isArray(parsed)) {
        const image = parsed.find((x) => x && (x.type === 'image' || x.source?.url));
        const text = parsed.find((x) => x && x.type === 'text' && typeof x.text === 'string');
        if (image?.source?.url) {
          return createChatImageViewContent(image.source.url);
        }
        if (text?.text) {
          return createChatMarkdownContent(text.text);
        }
      }
    } catch {
      // ignore parse errors and fall back to tool call
    }

    return createChatToolContent(
      payload.call_id || msgId,
      payload.name || item.name || '',
      payload.arguments || payload.args || item.arguments || '',
      output,
    );
  }
  return null;
}
