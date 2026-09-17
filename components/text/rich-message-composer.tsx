"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type RichMessageComposerProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "children"
> & {
  value: string
}

type SelectionOffsets = { start: number; end: number }

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function findSingleMarkerClose(value: string, marker: "*" | "`", start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== marker) continue
    if (value[index - 1] === marker || value[index + 1] === marker) continue
    return index
  }
  return -1
}

function decorateInline(value: string, depth = 0): string {
  if (!value) return ""
  if (depth > 12) return escapeHtml(value)

  let html = ""
  let cursor = 0

  while (cursor < value.length) {
    let match:
      | { kind: "code" | "bold" | "italic" | "spoiler"; index: number; open: string; closeIndex: number }
      | null = null

    for (let index = cursor; index < value.length; index += 1) {
      if (value[index] === "`" && value[index - 1] !== "`" && value[index + 1] !== "`") {
        const closeIndex = findSingleMarkerClose(value, "`", index + 1)
        if (closeIndex > index + 1) {
          match = { kind: "code", index, open: "`", closeIndex }
          break
        }
      }

      if (value.startsWith("||", index)) {
        const closeIndex = value.indexOf("||", index + 2)
        if (closeIndex >= index + 2) {
          match = { kind: "spoiler", index, open: "||", closeIndex }
          break
        }
      }

      if (value.startsWith("**", index)) {
        const closeIndex = value.indexOf("**", index + 2)
        if (closeIndex >= index + 2) {
          match = { kind: "bold", index, open: "**", closeIndex }
          break
        }
      }

      if (value[index] === "*" && value[index - 1] !== "*" && value[index + 1] !== "*") {
        const closeIndex = findSingleMarkerClose(value, "*", index + 1)
        if (closeIndex > index + 1) {
          match = { kind: "italic", index, open: "*", closeIndex }
          break
        }
      }
    }

    if (!match) {
      html += escapeHtml(value.slice(cursor))
      break
    }

    if (match.index > cursor) html += escapeHtml(value.slice(cursor, match.index))

    const close = match.open
    const inner = value.slice(match.index + match.open.length, match.closeIndex)
    const syntaxOpen = `<span class="tb-rich-composer-syntax">${escapeHtml(match.open)}</span>`
    const syntaxClose = `<span class="tb-rich-composer-syntax">${escapeHtml(close)}</span>`

    if (match.kind === "code") {
      html += `${syntaxOpen}<code class="tb-rich-composer-inline-code">${escapeHtml(inner)}</code>${syntaxClose}`
    } else if (match.kind === "bold") {
      html += `${syntaxOpen}<strong class="tb-rich-composer-bold">${decorateInline(inner, depth + 1)}</strong>${syntaxClose}`
    } else if (match.kind === "italic") {
      html += `${syntaxOpen}<em class="tb-rich-composer-italic">${decorateInline(inner, depth + 1)}</em>${syntaxClose}`
    } else {
      html += `${syntaxOpen}<span class="tb-rich-composer-spoiler">${decorateInline(inner, depth + 1)}</span>${syntaxClose}`
    }

    cursor = match.closeIndex + close.length
  }

  return html
}

function decorateTextSegment(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const heading = line.match(/^(#{1,3})( )(.*)$/)
      if (heading) {
        const level = heading[1].length
        return `<span class="tb-rich-composer-syntax">${escapeHtml(`${heading[1]} `)}</span><span class="tb-rich-composer-heading-${level}">${decorateInline(heading[3])}</span>`
      }

      if (line.startsWith("- ")) {
        return `<span class="tb-rich-composer-list-marker">${escapeHtml("- ")}</span>${decorateInline(line.slice(2))}`
      }

      return decorateInline(line)
    })
    .join("\n")
}

function decorateMarkdown(value: string) {
  if (!value) return ""

  let html = ""
  let cursor = 0

  while (cursor < value.length) {
    const openIndex = value.indexOf("```", cursor)
    if (openIndex < 0) {
      html += decorateTextSegment(value.slice(cursor))
      break
    }

    const closeIndex = value.indexOf("```", openIndex + 3)
    if (closeIndex < 0) {
      html += decorateTextSegment(value.slice(cursor))
      break
    }

    if (openIndex > cursor) html += decorateTextSegment(value.slice(cursor, openIndex))

    const inner = value.slice(openIndex + 3, closeIndex)
    html += `<span class="tb-rich-composer-syntax">\`\`\`</span><span class="tb-rich-composer-code-block">${escapeHtml(inner)}</span><span class="tb-rich-composer-syntax">\`\`\`</span>`
    cursor = closeIndex + 3
  }

  return html
}

function getSelectionOffsets(root: HTMLElement): SelectionOffsets {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    const end = root.textContent?.length ?? 0
    return { start: end, end }
  }

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    const end = root.textContent?.length ?? 0
    return { start: end, end }
  }

  const startRange = document.createRange()
  startRange.selectNodeContents(root)
  startRange.setEnd(range.startContainer, range.startOffset)

  const endRange = document.createRange()
  endRange.selectNodeContents(root)
  endRange.setEnd(range.endContainer, range.endOffset)

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  }
}

function resolveTextPosition(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let lastTextNode: Text | null = null

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    lastTextNode = node
    if (remaining <= node.data.length) return { node, offset: remaining }
    remaining -= node.data.length
  }

  if (lastTextNode) return { node: lastTextNode, offset: lastTextNode.data.length }
  return { node: root, offset: 0 }
}

function setSelectionOffsets(root: HTMLElement, start: number, end = start) {
  const selection = window.getSelection()
  if (!selection) return

  const max = root.textContent?.length ?? 0
  const safeStart = Math.max(0, Math.min(start, max))
  const safeEnd = Math.max(safeStart, Math.min(end, max))
  const from = resolveTextPosition(root, safeStart)
  const to = resolveTextPosition(root, safeEnd)
  const range = document.createRange()

  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // O editor continua funcional mesmo se o browser invalidar temporariamente o Range.
  }
}

function insertPlainText(root: HTMLElement, text: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) {
    root.append(document.createTextNode(text))
    setSelectionOffsets(root, root.textContent?.length ?? 0)
    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

export const RichMessageComposer = React.forwardRef<HTMLTextAreaElement, RichMessageComposerProps>(function RichMessageComposer(
  {
    value,
    onChange,
    onClick,
    onKeyDown,
    onKeyUp,
    onFocus,
    onBlur,
    onInput: externalOnInput,
    className,
    placeholder,
    maxLength,
    rows: _rows,
    readOnly,
    disabled,
    spellCheck,
    autoFocus,
    id,
    title,
    style,
    ...rest
  },
  forwardedRef,
) {
  const editorRef = React.useRef<HTMLDivElement>(null)
  const composingRef = React.useRef(false)
  const valueRef = React.useRef(value)
  const pendingSelectionRef = React.useRef<SelectionOffsets | null>(null)

  valueRef.current = value

  const syncDom = React.useCallback((nextValue: string, selection?: SelectionOffsets | null) => {
    const editor = editorRef.current
    if (!editor) return
    const desiredHtml = decorateMarkdown(nextValue)
    if (editor.innerHTML !== desiredHtml) editor.innerHTML = desiredHtml
    if (selection && document.activeElement === editor) {
      setSelectionOffsets(editor, selection.start, selection.end)
    }
  }, [])

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const selection = document.activeElement === editor ? getSelectionOffsets(editor) : pendingSelectionRef.current
    syncDom(value, selection)
    pendingSelectionRef.current = null
  }, [syncDom, value])

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const textareaLike = editor as unknown as HTMLTextAreaElement
    const getStart = () => getSelectionOffsets(editor).start
    const getEnd = () => getSelectionOffsets(editor).end

    try {
      Object.defineProperty(editor, "value", {
        configurable: true,
        get: () => editor.textContent ?? "",
        set: (next: string) => syncDom(String(next ?? "")),
      })
      Object.defineProperty(editor, "selectionStart", { configurable: true, get: getStart })
      Object.defineProperty(editor, "selectionEnd", { configurable: true, get: getEnd })
      textareaLike.setSelectionRange = (start: number, end: number) => {
        editor.focus()
        setSelectionOffsets(editor, start, end)
      }
      textareaLike.select = () => {
        editor.focus()
        setSelectionOffsets(editor, 0, editor.textContent?.length ?? 0)
      }
    } catch {
      // Alguns browsers podem proteger propriedades do HTMLElement; o editor ainda funciona sem o shim.
    }
  }, [syncDom])

  React.useImperativeHandle(forwardedRef, () => editorRef.current as unknown as HTMLTextAreaElement, [])

  React.useEffect(() => {
    if (!autoFocus) return
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [autoFocus])

  const emitChange = React.useCallback((nextValue: string, selection: SelectionOffsets) => {
    const editor = editorRef.current
    if (!editor) return
    pendingSelectionRef.current = selection
    const textareaLike = editor as unknown as HTMLTextAreaElement
    onChange?.({
      target: textareaLike,
      currentTarget: textareaLike,
    } as React.ChangeEvent<HTMLTextAreaElement>)
  }, [onChange])

  const normalizeAndEmit = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor || composingRef.current) return

    let nextValue = editor.textContent ?? ""
    let selection = getSelectionOffsets(editor)

    if (typeof maxLength === "number" && maxLength >= 0 && nextValue.length > maxLength) {
      nextValue = nextValue.slice(0, maxLength)
      selection = {
        start: Math.min(selection.start, maxLength),
        end: Math.min(selection.end, maxLength),
      }
    }

    syncDom(nextValue, selection)
    emitChange(nextValue, selection)
  }, [emitChange, maxLength, syncDom])

  return (
    <div
      ref={editorRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      aria-readonly={readOnly || undefined}
      data-placeholder={placeholder || undefined}
      contentEditable={!disabled && !readOnly}
      suppressContentEditableWarning
      spellCheck={spellCheck}
      tabIndex={disabled ? -1 : 0}
      title={title}
      style={style}
      className={cn(
        "tb-rich-composer whitespace-pre-wrap break-words",
        disabled && "cursor-not-allowed opacity-50",
        readOnly && "cursor-default",
        className,
      )}
      onInput={(event) => {
        normalizeAndEmit()
        externalOnInput?.(event as unknown as React.FormEvent<HTMLTextAreaElement>)
      }}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => {
        composingRef.current = false
        normalizeAndEmit()
      }}
      onBeforeInput={(event) => {
        const native = event.nativeEvent as InputEvent
        if (native.inputType !== "insertParagraph" && native.inputType !== "insertLineBreak") return
        event.preventDefault()
        if (disabled || readOnly) return
        const editor = editorRef.current
        if (!editor) return
        insertPlainText(editor, "\n")
        normalizeAndEmit()
      }}
      onPaste={(event) => {
        if (disabled || readOnly) return
        event.preventDefault()
        const editor = editorRef.current
        if (!editor) return
        const text = event.clipboardData.getData("text/plain")
        insertPlainText(editor, text)
        normalizeAndEmit()
      }}
      onClick={(event) => onClick?.(event as unknown as React.MouseEvent<HTMLTextAreaElement>)}
      onKeyDown={(event) => {
        onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
        if (event.defaultPrevented || event.key !== "Enter") return
        // Em um textarea real o Shift+Enter insere uma quebra de linha. Aqui fazemos isso manualmente
        // para manter o DOM sempre como texto puro decorado, sem DIV/BR extras do contentEditable.
        if (event.shiftKey) {
          event.preventDefault()
          const editor = editorRef.current
          if (!editor) return
          insertPlainText(editor, "\n")
          normalizeAndEmit()
        }
      }}
      onKeyUp={(event) => onKeyUp?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>)}
      onFocus={(event) => onFocus?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)}
      onBlur={(event) => onBlur?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    />
  )
})
