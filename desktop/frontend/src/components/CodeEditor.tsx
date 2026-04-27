import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// Wire Monaco workers once. Other languages (toml/markdown) don't need workers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  },
}

export type EditorLanguage = 'markdown' | 'json' | 'toml' | 'shell' | 'plaintext'

export function inferLanguage(path: string): EditorLanguage {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell'
  return 'plaintext'
}

interface Props {
  value: string
  language: EditorLanguage
  readOnly?: boolean
  onChange?: (next: string) => void
  height?: number | string
}

export function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  height = '100%',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const isDark = document.documentElement.getAttribute('data-mode') !== 'light'
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language,
      readOnly,
      theme: isDark ? 'vs-dark' : 'vs',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      wordWrap: 'on',
      renderLineHighlight: 'gutter',
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
    })
    editorRef.current = editor

    const sub = editor.onDidChangeModelContent(() => {
      if (onChange) onChange(editor.getValue())
    })

    // React to theme switches
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-mode') !== 'light'
      monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })

    return () => {
      sub.dispose()
      observer.disconnect()
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (avoids cursor jumps from controlled input)
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (ed.getValue() !== value) ed.setValue(value)
  }, [value])

  // Sync language changes
  useEffect(() => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (model) monaco.editor.setModelLanguage(model, language)
  }, [language])

  // Sync readOnly toggle
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--border-sub)',
      }}
    />
  )
}

interface DiffProps {
  original: string
  modified: string
  language: EditorLanguage
  height?: number | string
}

export function CodeDiff({ original, modified, language, height = '100%' }: DiffProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const isDark = document.documentElement.getAttribute('data-mode') !== 'light'
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      theme: isDark ? 'vs-dark' : 'vs',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderSideBySide: true,
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
    })
    diffEditorRef.current = diffEditor

    diffEditor.setModel({
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(modified, language),
    })

    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-mode') !== 'light'
      monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })

    return () => {
      const prev = diffEditor.getModel()
      observer.disconnect()
      diffEditor.dispose()
      prev?.original.dispose()
      prev?.modified.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const diff = diffEditorRef.current
    if (!diff) return
    // Dispose previous models before swapping — otherwise each edit selection
    // leaks a pair of ITextModel instances for the lifetime of the session.
    const prev = diff.getModel()
    diff.setModel({
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(modified, language),
    })
    prev?.original.dispose()
    prev?.modified.dispose()
  }, [original, modified, language])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--border-sub)',
      }}
    />
  )
}
