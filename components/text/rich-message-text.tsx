"use client"

import * as React from "react"
import Link from "next/link"
import type { ChatMention } from "@/lib/types"
import { cn } from "@/lib/utils"

type RichMessageTextProps = {
  content: string
  mentions?: ChatMention[]
  own?: boolean
  className?: string
  mentionClassName?: string
  linkClassName?: string
  projectMentionsClickable?: boolean
}

type TokenMatch =
  | { kind: "mention"; index: number; length: number; mention: ChatMention }
  | { kind: "url"; index: number; length: number; value: string }

type RenderContext = {
  mentions: ChatMention[]
  own: boolean
  mentionClassName?: string
  linkClassName?: string
  projectMentionsClickable: boolean
}

type InlineMarker = {
  kind: "bold" | "italic" | "spoiler"
  index: number
  openLength: number
  closeIndex: number
  closeLength: number
}

type MessageSegment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }

const URL_PATTERN = /(?:https?:\/\/|ftps?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/

function mentionToken(mention: ChatMention) {
  return `@${mention.label}`
}

function normalizeHref(value: string) {
  return /^www\./i.test(value) ? `https://${value}` : value
}

function splitUrlTrailingPunctuation(value: string) {
  let url = value
  let trailing = ""

  const punctuation = url.match(TRAILING_URL_PUNCTUATION)?.[0] ?? ""
  if (punctuation) {
    url = url.slice(0, -punctuation.length)
    trailing = punctuation + trailing
  }

  // Fecha parênteses/colchetes/chaves apenas quando eles não têm par de abertura
  // dentro da própria URL. Isso evita transformar "https://site.com)." em um href inválido.
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]]
  for (const [open, close] of pairs) {
    while (url.endsWith(close)) {
      const opens = url.split(open).length - 1
      const closes = url.split(close).length - 1
      if (closes <= opens) break
      url = url.slice(0, -1)
      trailing = close + trailing
    }
  }

  return { url, trailing }
}

function findNextUrl(content: string, cursor: number): TokenMatch | null {
  URL_PATTERN.lastIndex = cursor
  const match = URL_PATTERN.exec(content)
  if (!match || match.index < cursor) return null

  const { url } = splitUrlTrailingPunctuation(match[0])
  if (!url) return null
  return { kind: "url", index: match.index, length: url.length, value: url }
}

function findNextMention(content: string, cursor: number, mentions: ChatMention[]): TokenMatch | null {
  let result: TokenMatch | null = null

  for (const mention of mentions) {
    const token = mentionToken(mention)
    const index = content.indexOf(token, cursor)
    if (index < 0) continue
    if (!result || index < result.index || (index === result.index && token.length > result.length)) {
      result = { kind: "mention", index, length: token.length, mention }
    }
  }

  return result
}

function nextToken(content: string, cursor: number, mentions: ChatMention[]): TokenMatch | null {
  const url = findNextUrl(content, cursor)
  const mention = findNextMention(content, cursor, mentions)
  if (!url) return mention
  if (!mention) return url
  if (url.index < mention.index) return url
  if (mention.index < url.index) return mention
  return mention.length >= url.length ? mention : url
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = React.useState(false)

  const reveal = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation()
    setRevealed(true)
  }, [])

  return (
    <span
      role={revealed ? undefined : "button"}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : "Mostrar spoiler"}
      aria-expanded={revealed || undefined}
      onClick={revealed ? undefined : reveal}
      onKeyDown={revealed ? undefined : (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        reveal(event)
      }}
      className={cn(
        "relative inline rounded-[0.3rem] px-1 py-0.5 transition-colors",
        revealed
          ? "bg-muted/55"
          : "cursor-pointer select-none bg-foreground/20 hover:bg-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
      title={revealed ? undefined : "Clique para revelar o spoiler"}
    >
      <span className={cn("transition-opacity", !revealed && "pointer-events-none opacity-0")}>{children}</span>
    </span>
  )
}

function renderTokenizedText(content: string, context: RenderContext, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < content.length) {
    const match = nextToken(content, cursor, context.mentions)
    if (!match) {
      nodes.push(content.slice(cursor))
      break
    }

    if (match.index > cursor) nodes.push(content.slice(cursor, match.index))

    if (match.kind === "url") {
      const rawMatched = content.slice(match.index, match.index + match.length)
      nodes.push(
        <a
          key={`${keyPrefix}-url-${key++}`}
          href={normalizeHref(match.value)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "break-all font-medium text-blue-600 underline decoration-blue-600/70 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400/70 dark:hover:text-blue-300 dark:hover:decoration-blue-300",
            context.linkClassName,
          )}
          title="Abrir link em uma nova aba"
        >
          {rawMatched}
        </a>,
      )
      cursor = match.index + match.length
      continue
    }

    const token = mentionToken(match.mention)
    const mentionClasses = cn(
      "inline-flex max-w-full items-center rounded-md px-1 py-0.5 font-medium no-underline",
      context.own
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/20"
        : "bg-primary/12 text-primary hover:bg-primary/18",
      context.mentionClassName,
    )

    if (match.mention.kind === "project" && context.projectMentionsClickable) {
      nodes.push(
        <Link
          key={`${keyPrefix}-mention-${key++}`}
          href={`/projetos/${match.mention.id}`}
          className={mentionClasses}
          onClick={(event) => event.stopPropagation()}
          title={`Abrir projeto ${match.mention.label}`}
        >
          {token}
        </Link>,
      )
    } else {
      nodes.push(
        <span key={`${keyPrefix}-mention-${key++}`} className={mentionClasses} title={`Usuário mencionado: ${match.mention.label}`}>
          {token}
        </span>,
      )
    }

    cursor = match.index + match.length
  }

  return nodes
}

function findSingleAsteriskClose(content: string, start: number) {
  for (let index = start; index < content.length; index += 1) {
    if (content[index] !== "*") continue
    if (content[index - 1] === "*" || content[index + 1] === "*") continue
    return index
  }
  return -1
}

function findNextInlineMarker(content: string, cursor: number): InlineMarker | null {
  for (let index = cursor; index < content.length; index += 1) {
    if (content.startsWith("||", index)) {
      const closeIndex = content.indexOf("||", index + 2)
      if (closeIndex >= index + 2) {
        return { kind: "spoiler", index, openLength: 2, closeIndex, closeLength: 2 }
      }
    }

    if (content.startsWith("**", index)) {
      const closeIndex = content.indexOf("**", index + 2)
      if (closeIndex >= index + 2) {
        return { kind: "bold", index, openLength: 2, closeIndex, closeLength: 2 }
      }
    }

    if (content[index] === "*" && content[index - 1] !== "*" && content[index + 1] !== "*") {
      const closeIndex = findSingleAsteriskClose(content, index + 1)
      if (closeIndex > index + 1) {
        return { kind: "italic", index, openLength: 1, closeIndex, closeLength: 1 }
      }
    }
  }

  return null
}

function renderInline(content: string, context: RenderContext, keyPrefix: string, depth = 0): React.ReactNode[] {
  if (!content) return []
  if (depth > 12) return renderTokenizedText(content, context, `${keyPrefix}-plain`)

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < content.length) {
    const marker = findNextInlineMarker(content, cursor)
    if (!marker) {
      nodes.push(...renderTokenizedText(content.slice(cursor), context, `${keyPrefix}-${key++}`))
      break
    }

    if (marker.index > cursor) {
      nodes.push(...renderTokenizedText(content.slice(cursor, marker.index), context, `${keyPrefix}-${key++}`))
    }

    const inner = content.slice(marker.index + marker.openLength, marker.closeIndex)
    const children = renderInline(inner, context, `${keyPrefix}-${marker.kind}-${key++}`, depth + 1)

    if (marker.kind === "bold") {
      nodes.push(<strong key={`${keyPrefix}-bold-node-${key++}`} className="font-semibold text-current">{children}</strong>)
    } else if (marker.kind === "italic") {
      nodes.push(<em key={`${keyPrefix}-italic-node-${key++}`} className="italic">{children}</em>)
    } else {
      nodes.push(<Spoiler key={`${keyPrefix}-spoiler-node-${key++}`}>{children}</Spoiler>)
    }

    cursor = marker.closeIndex + marker.closeLength
  }

  return nodes
}

function splitMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let cursor = 0

  while (cursor < content.length) {
    const openIndex = content.indexOf("```", cursor)
    if (openIndex < 0) {
      segments.push({ kind: "text", value: content.slice(cursor) })
      break
    }

    const closeIndex = content.indexOf("```", openIndex + 3)
    if (closeIndex < 0) {
      segments.push({ kind: "text", value: content.slice(cursor) })
      break
    }

    if (openIndex > cursor) segments.push({ kind: "text", value: content.slice(cursor, openIndex) })

    let code = content.slice(openIndex + 3, closeIndex)
    // No padrão de bloco (``` + quebra de linha), a quebra serve apenas para abrir/fechar o bloco.
    if (code.startsWith("\n")) code = code.slice(1)
    if (code.endsWith("\n")) code = code.slice(0, -1)
    // Para o formato curto (``` mensagem```), remove apenas o espaço visual em torno do conteúdo.
    if (!code.includes("\n")) code = code.trim()
    segments.push({ kind: "code", value: code })
    cursor = closeIndex + 3
  }

  if (segments.length === 0) segments.push({ kind: "text", value: content })
  return segments
}

function isSpecialBlockLine(line: string) {
  return /^(?:#{1,3} |- )/.test(line)
}

function renderTextBlocks(value: string, context: RenderContext, keyPrefix: string) {
  const lines = value.split("\n")
  const blocks: React.ReactNode[] = []
  let index = 0
  let blockKey = 0

  while (index < lines.length) {
    const line = lines[index] ?? ""

    if (!line.length) {
      blocks.push(<div key={`${keyPrefix}-gap-${blockKey++}`} className="h-1.5" aria-hidden="true" />)
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,3}) (.+)$/)
    if (heading) {
      const level = heading[1].length
      const headingContent = renderInline(heading[2], context, `${keyPrefix}-heading-${blockKey}`)
      const headingClass = level === 1
        ? "text-[1.5em] font-bold leading-tight"
        : level === 2
          ? "text-[1.25em] font-bold leading-tight"
          : "text-[1.08em] font-semibold leading-snug"

      const HeadingTag = level === 1 ? "h1" : level === 2 ? "h2" : "h3"
      blocks.push(
        <HeadingTag key={`${keyPrefix}-heading-node-${blockKey++}`} className={headingClass}>
          {headingContent}
        </HeadingTag>,
      )
      index += 1
      continue
    }

    if (line.startsWith("- ")) {
      const items: string[] = []
      while (index < lines.length && (lines[index] ?? "").startsWith("- ")) {
        items.push((lines[index] ?? "").slice(2))
        index += 1
      }
      blocks.push(
        <ul key={`${keyPrefix}-list-${blockKey++}`} className="list-disc space-y-0.5 pl-5 marker:text-current/70">
          {items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-list-item-${blockKey}-${itemIndex}`} className="pl-0.5">
              {renderInline(item, context, `${keyPrefix}-list-inline-${blockKey}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ""
      if (!current.length || isSpecialBlockLine(current)) break
      paragraphLines.push(current)
      index += 1
    }

    if (paragraphLines.length) {
      const paragraph = paragraphLines.join("\n")
      blocks.push(
        <p key={`${keyPrefix}-paragraph-${blockKey++}`} className="whitespace-pre-wrap">
          {renderInline(paragraph, context, `${keyPrefix}-paragraph-inline-${blockKey}`)}
        </p>,
      )
      continue
    }

    // Segurança para qualquer linha que não tenha entrado nos casos acima.
    blocks.push(
      <p key={`${keyPrefix}-fallback-${blockKey++}`} className="whitespace-pre-wrap">
        {renderInline(line, context, `${keyPrefix}-fallback-inline-${blockKey}`)}
      </p>,
    )
    index += 1
  }

  return blocks
}

export function RichMessageText({
  content,
  mentions = [],
  own = false,
  className,
  mentionClassName,
  linkClassName,
  projectMentionsClickable = true,
}: RichMessageTextProps) {
  const uniqueMentions = React.useMemo(
    () => Array.from(new Map(mentions.map((mention) => [`${mention.kind}:${mention.id}`, mention])).values())
      .sort((a, b) => mentionToken(b).length - mentionToken(a).length),
    [mentions],
  )

  const context = React.useMemo<RenderContext>(() => ({
    mentions: uniqueMentions,
    own,
    mentionClassName,
    linkClassName,
    projectMentionsClickable,
  }), [uniqueMentions, own, mentionClassName, linkClassName, projectMentionsClickable])

  const segments = React.useMemo(() => splitMessageSegments(content), [content])

  return (
    <div className={cn("min-w-0 break-words", className)}>
      {segments.map((segment, index) => {
        if (segment.kind === "code") {
          return (
            <pre
              key={`code-${index}`}
              className={cn(
                "my-1.5 max-w-full overflow-x-auto rounded-lg border px-3 py-2.5 text-[0.9em] leading-relaxed",
                own
                  ? "border-primary-foreground/15 bg-black/20 text-current"
                  : "border-border/80 bg-muted/55 text-foreground/95",
              )}
            >
              <code className="font-mono whitespace-pre">{segment.value}</code>
            </pre>
          )
        }

        return (
          <React.Fragment key={`text-${index}`}>
            {renderTextBlocks(segment.value, context, `segment-${index}`)}
          </React.Fragment>
        )
      })}
    </div>
  )
}
