import {
  AGENT_SCOPE_CALL_MESSAGE_TYPES,
  AGENT_SCOPE_MESSAGE_ROLES,
  AGENT_SCOPE_THINKING_MESSAGE_TYPES,
  AGENT_SCOPE_TEXT_MESSAGE_TYPES,
  CHAT_MESSAGE_ROLES,
  DEFAULT_STATUS_MAP,
  createChatMarkdownContent,
  createChatThinkingContent,
  createChatToolContent,
  getContentArray,
  getMessageContentSource,
  getMessageText,
  mapContentItemToChatContent,
} from './common.js';

function extractHistoryMessages(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.output)) return payload.output;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function getStatus(status) {
  return DEFAULT_STATUS_MAP[status] || 'generating';
}

function isCompleteHistoryStatus(status) {
  return status === 'completed' || status === 'finished';
}

function mapPlainHistoryMessage(message, type, content, index) {
  if (AGENT_SCOPE_THINKING_MESSAGE_TYPES.has(type)) {
    content.push(createChatThinkingContent(getMessageText(message), true, true));
    return;
  }

  if (AGENT_SCOPE_CALL_MESSAGE_TYPES.has(type)) {
    const first = getMessageContentSource(message)[0] || message.content?.[0] || {};
    content.push(
      createChatToolContent(
        first?.data?.call_id || message.id || `tool_${index}`,
        first?.data?.name || type,
        first?.data?.arguments || '',
        first?.data?.output || '',
      ),
    );
    return;
  }

  if (AGENT_SCOPE_TEXT_MESSAGE_TYPES.has(type) || AGENT_SCOPE_MESSAGE_ROLES.has(type)) {
    const text = getMessageText(message);
    if (text) content.push(createChatMarkdownContent(text));
  }
}

function mapArrayHistoryMessage(message, type, content) {
  const contentSource = getMessageContentSource(message);
  if (AGENT_SCOPE_THINKING_MESSAGE_TYPES.has(type)) {
    const text = contentSource
      .map((item) => item?.text || item?.refusal || '')
      .filter(Boolean)
      .join('');
    if (text) content.push(createChatThinkingContent(text, isCompleteHistoryStatus(message.status), true));
    return;
  }

  if (AGENT_SCOPE_CALL_MESSAGE_TYPES.has(type)) {
    const first = contentSource[0] || {};
    const last = contentSource[contentSource.length - 1] || first;
    const payload = first?.data || {};
    const output = last?.data || {};
    content.push(
      createChatToolContent(
        payload.call_id || output.call_id || message.id || 'tool',
        payload.name || output.name || type,
        payload.arguments || payload.args || '',
        output.output || payload.output || '',
      ),
    );
    return;
  }

  for (const item of contentSource) {
    const mapped = mapContentItemToChatContent(item, message.id);
    if (mapped) content.push(mapped);
  }
}

function mapHistoryMessageToChatMessage(message, index = 0) {
  if (!message) return null;
  const role = CHAT_MESSAGE_ROLES.has(message.role) ? message.role : 'assistant';
  const type = message.type || 'message';
  const content = [];

  if (!Array.isArray(message.content)) {
    mapPlainHistoryMessage(message, type, content, index);
  } else {
    mapArrayHistoryMessage(message, type, content);
  }

  return {
    id: message.id || `hist_${index}`,
    role,
    status: getStatus(message.status),
    content,
  };
}

function mergeHistoryToolMessages(messages = []) {
  const merged = [];
  const toolIndexByCallId = new Map();

  for (const message of messages) {
    const type = message?.type || '';
    if (!AGENT_SCOPE_CALL_MESSAGE_TYPES.has(type)) {
      merged.push(message);
      continue;
    }

    const content = getContentArray(message);
    const first = content[0] || {};
    const payload = first?.data || {};
    const callId = payload.call_id || payload.callId || message.id || '';
    const existingIndex = toolIndexByCallId.get(callId);

    if (existingIndex == null) {
      toolIndexByCallId.set(callId, merged.length);
      merged.push({ ...message, content: [...content] });
      continue;
    }

    const existing = merged[existingIndex];
    const existingContent = Array.isArray(existing.content) ? existing.content : [];
    merged[existingIndex] = {
      ...existing,
      status: message.status || existing.status,
      content: [...existingContent, ...content],
    };
  }

  return merged;
}

function groupChatMessages(messages) {
  const groupedMessages = [];
  let activeAssistantMessage = null;

  for (const message of messages) {
    if (message.role === 'user') {
      if (activeAssistantMessage) {
        groupedMessages.push(activeAssistantMessage);
        activeAssistantMessage = null;
      }
      groupedMessages.push(message);
      continue;
    }

    if (!activeAssistantMessage) {
      activeAssistantMessage = { ...message, content: [...message.content] };
      continue;
    }

    activeAssistantMessage = {
      ...activeAssistantMessage,
      status: message.status || activeAssistantMessage.status,
      content: [...activeAssistantMessage.content, ...message.content],
    };
  }

  if (activeAssistantMessage) {
    groupedMessages.push(activeAssistantMessage);
  }

  return groupedMessages;
}

function createChatMessageAdapter() {
  return {
    fromHistoryMessages(messages = []) {
      const mergedMessages = mergeHistoryToolMessages(messages);
      const mappedMessages = mergedMessages
        .map((message, index) => mapHistoryMessageToChatMessage(message, index))
        .filter(Boolean);
      return groupChatMessages(mappedMessages);
    },
  };
}

export function fromAgentScopeHistoryToChatMessages(historyPayload) {
  const adapter = createChatMessageAdapter();
  const historyMessages = extractHistoryMessages(historyPayload);
  return adapter.fromHistoryMessages(historyMessages);
}
