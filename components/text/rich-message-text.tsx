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

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < content.length) {
    const match = nextToken(content, cursor, uniqueMentions)
    if (!match) {
      nodes.push(content.slice(cursor))
      break
    }

    if (match.index > cursor) nodes.push(content.slice(cursor, match.index))

    if (match.kind === "url") {
      const rawMatched = content.slice(match.index, match.index + match.length)
      nodes.push(
        <a
          key={`url-${key++}`}
          href={normalizeHref(match.value)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "break-all font-medium text-blue-600 underline decoration-blue-600/70 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-700 dark:text-blue-400 dark:decoration-blue-400/70 dark:hover:text-blue-300 dark:hover:decoration-blue-300",
            linkClassName,
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
      own
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/20"
        : "bg-primary/12 text-primary hover:bg-primary/18",
      mentionClassName,
    )

    if (match.mention.kind === "project" && projectMentionsClickable) {
      nodes.push(
        <Link
          key={`mention-${key++}`}
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
        <span key={`mention-${key++}`} className={mentionClasses} title={`Usuário mencionado: ${match.mention.label}`}>
          {token}
        </span>,
      )
    }

    cursor = match.index + match.length
  }

  return <p className={cn("whitespace-pre-wrap break-words", className)}>{nodes}</p>
}
