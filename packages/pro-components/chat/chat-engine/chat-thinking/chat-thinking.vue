<template>
  <div class="chat-thinking" :class="{ 'chat-thinking--collapsed': isCollapsed }">
    <div class="chat-thinking__header" @click="toggleCollapsed">
      <span class="chat-thinking__title">{{ title }}</span>
      <span class="chat-thinking__toggle">{{ isCollapsed ? '展开' : '收起' }}</span>
    </div>

    <div v-if="!isCollapsed" class="chat-thinking__body">
      <slot>
        <pre class="chat-thinking__text">{{ text }}</pre>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    text?: string;
    title?: string;
    collapsed?: boolean;
  }>(),
  {
    text: '',
    title: '思考中',
    collapsed: false,
  },
);

const isCollapsed = ref(props.collapsed);

watch(
  () => props.collapsed,
  (value) => {
    isCollapsed.value = value;
  },
);

const title = computed(() => props.title || '思考中');
const text = computed(() => props.text || '');

const toggleCollapsed = () => {
  isCollapsed.value = !isCollapsed.value;
};
</script>

<style scoped>
.chat-thinking {
  border-radius: 8px;
  border: 1px solid var(--td-border-level-1-color, #e7e7e7);
  background: var(--td-bg-color-container, #fff);
  overflow: hidden;
}

.chat-thinking__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  color: var(--td-text-color-primary, #111);
  font-size: 14px;
}

.chat-thinking__toggle {
  color: var(--td-text-color-placeholder, #888);
  font-size: 12px;
  flex-shrink: 0;
}

.chat-thinking__body {
  padding: 0 12px 12px;
}

.chat-thinking__text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--td-text-color-secondary, #666);
  font-size: 13px;
  line-height: 1.6;
}
</style>
