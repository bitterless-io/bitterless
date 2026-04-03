<template>
  <div class="quill-editor">
    <div class="quill-editor__container" ref="editorRef"></div>
    <div v-if="props.placeholder" class="quill-editor__placeholder">
      {{ props.placeholder }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import Quill from 'quill';
import 'quill/dist/quill.bubble.css';

interface Props {
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [content: string];
  compositionStart: [];
  compositionEnd: [];
  textChange: [text: string];
}>();

const editorRef = ref<HTMLElement | null>(null);
let quill: Quill | null = null;

const onCompositionStart = (): void => {
  emit('compositionStart');
};

const onCompositionEnd = (): void => {
  emit('compositionEnd');

};

const onTextChange = (): void => {
  if (!quill) return;
  const text = quill.getText();
  emit('update:modelValue', text.trim());
  emit('textChange', text);
};

const getPlainText = (): string => {
  if (!quill) return '';
  return quill.getText().trim();
};

const clear = (): void => {
  if (!quill) return;
  quill.setText('');
};

const setText = (text: string): void => {
  if (!quill) return;
  quill.setText(text);
  const length = quill.getLength();
  quill.setSelection(length, 0);
};

const focus = (): void => {
  if (!quill) return;
  quill.focus();
  const length = quill.getLength();
  quill.setSelection(length, 0);
};

onMounted(() => {
  if (!editorRef.value) return;
  quill = new Quill(editorRef.value, {
    theme: 'bubble',
    modules: {
      toolbar: false,
      clipboard: {
        matchVisual: false
      },
      keyboard: {
        bindings: {
          enter: {
            key: 'Enter',
            handler: () => {
              const text = getPlainText();
              if (text) {
                emit('submit', text);
                clear();
              }
            }
          },
          shiftEnter: {
            key: 'Enter',
            shiftKey: true,
            handler: (_range: any, _context: any) => {
              if (!quill) return true;
              const selection = quill.getSelection();
              if (selection) {
                quill.insertText(selection.index, '\n');
                quill.setSelection(selection.index + 1, 0);
              }
              return false;
            }
          }
        }
      }
    }
  });

  quill.on('text-change', onTextChange);

  const editor = editorRef.value.querySelector('.ql-editor');
  if (editor) {
    editor.addEventListener('compositionstart', onCompositionStart);
    editor.addEventListener('compositionend', onCompositionEnd);
    editor.addEventListener(
      'paste',
      (e: Event) => {
        const clipboardEvent = e as ClipboardEvent;
        clipboardEvent.preventDefault();
        clipboardEvent.stopPropagation();
        const text = (clipboardEvent.clipboardData?.getData('text/plain') ?? '').trim();
        if (!text || !quill) return;
        const range = quill.getSelection();
        if (range) {
          quill.deleteText(range.index, range.length);
          quill.insertText(range.index, text);
          quill.setSelection(range.index + text.length, 0);
        }
      },
      true
    );
  }
});

watch(
  () => props.disabled,
  (val) => {
    if (quill) {
      quill.enable(!val);
    }
  }
);

onBeforeUnmount(() => {
  if (editorRef.value) {
    const editor = editorRef.value.querySelector('.ql-editor');
    if (editor) {
      editor.removeEventListener('compositionstart', onCompositionStart);
      editor.removeEventListener('compositionend', onCompositionEnd);
    }
  }

  quill = null;
});

defineExpose({ getPlainText, clear, setText, focus });
</script>

<style lang="less">
@import './QuillEditor.less';
</style>
