"use client"

import * as React from "react"
import {
  ArrowLeft,
  Clock3,
  Headphones,
  MessageCircleMore,
  Paperclip,
  Phone,
  Radio,
  Search,
  Send,
  UserRound,
  UsersRound,
  Video,
} from "lucide-react"
import type { ChatConversation, ChatMeeting, MeetingMemberStatus, MeetingMode, Member } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
import { GroupDialog } from "@/components/chat/group-dialog"
import { MeetingDialog } from "@/components/chat/meeting-dialog"
import { CallRoom } from "@/components/chat/call-room"
import { AudioMessage } from "@/components/chat/audio-message"
import { AudioRecordButton } from "@/components/chat/audio-record-button"
import { ChatAttachmentPreviewDialog } from "@/components/chat/chat-attachment-preview-dialog"
import { ChatMediaMessage } from "@/components/chat/chat-media-message"
import { Button } from "@/components/ui/button"
import { AppLoadingSkeleton } from "@/components/app-loading-skeleton"
import { cn } from "@/lib/utils"
import { primeCallAudio } from "@/lib/webrtc/audio-playback"

type ChatTab = "conversations" | "groups" | "users" | "meetings"

function timeLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

function conversationTitle(
  conversation: ChatConversation,
  currentUserId: string,
  members: Member[],
) {
  if (conversation.kind === "group") return conversation.name || "Grupo"
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  return members.find((member) => member.id === otherId)?.name ?? "Conversa"
}

function ConversationAvatar({
  conversation,
  currentUserId,
  members,
  className,
}: {
  conversation: ChatConversation
  currentUserId: string
  members: Member[]
  className?: string
}) {
  if (conversation.kind === "group") {
    return (
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary", className)}>
        <UsersRound className="size-4" />
      </span>
    )
  }
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  const member = members.find((item) => item.id === otherId)
  return <MemberAvatar member={member} className={cn("size-10 text-xs ring-0", className)} />
}

function meetingStatusFor(meeting: ChatMeeting, userId: string): MeetingMemberStatus | undefined {
  return meeting.memberStates.find((member) => member.userId === userId)?.status
}

function MeetingListItem({
  meeting,
  status,
  onOpen,
  loading = false,
}: {
  meeting: ChatMeeting
  status?: MeetingMemberStatus
  onOpen: () => void
  loading?: boolean
}) {
  const ended = Boolean(meeting.endedAt)
  const declined = status === "declined"
  const disabled = ended || declined || loading
  const subtitle = ended
    ? `Encerrada · ${timeLabel(meeting.endedAt!)}`
    : status === "pending"
      ? "Chamada recebida · Clique para atender"
      : status === "left"
        ? "Você saiu · Entrar novamente"
        : declined
          ? "Chamada recusada"
          : `${meeting.memberIds.length} convidados · Entrar na sala`

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
        disabled ? "opacity-60" : "hover:bg-muted",
      )}
    >
      <span className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        ended || declined ? "bg-muted text-muted-foreground" : status === "pending" ? "bg-primary/10 text-primary" : "bg-success/12 text-success",
      )}>
        {meeting.mode === "video" ? <Video className="size-4" /> : <Headphones className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold">{meeting.title}</span>
          {!ended && !declined && <span className={cn("size-2 shrink-0 rounded-full", status === "pending" ? "bg-primary" : "bg-success")} />}
        </span>
        <span className="mt-0.5 block truncate text-[0.63rem] text-muted-foreground">
          {loading ? "Entrando..." : subtitle}
        </span>
      </span>
    </button>
  )
}

export function ChatView() {
  const {
    members,
    chatConversations,
    chatMeetings,
    currentUserId,
    currentUserRole,
    chatHydrated,
    ensureDirectConversation,
    sendChatMessage,
    sendChatAudio,
    sendChatMedia,
    createMeeting,
    answerMeetingInvite,
    joinMeeting,
  } = useStore()
  const [tab, setTab] = React.useState<ChatTab>("conversations")
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState("")
  const [activeMeetingId, setActiveMeetingId] = React.useState<string | null>(null)
  const [openingUserId, setOpeningUserId] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [startingMeetingMode, setStartingMeetingMode] = React.useState<MeetingMode | null>(null)
  const [openingMeetingId, setOpeningMeetingId] = React.useState<string | null>(null)
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([])
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = React.useState(false)
  const [sendingMedia, setSendingMedia] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null)
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null)

  const myConversations = React.useMemo(
    () =>
      chatConversations
        .filter((conversation) => conversation.memberIds.includes(currentUserId))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chatConversations, currentUserId],
  )

  const myMeetings = React.useMemo(
    () =>
      chatMeetings
        .filter((meeting) => meeting.memberIds.includes(currentUserId))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chatMeetings, currentUserId],
  )

  const selected = myConversations.find((conversation) => conversation.id === selectedId) ?? null
  const activeMeeting = chatMeetings.find((meeting) => meeting.id === activeMeetingId) ?? null
  const q = query.trim().toLowerCase()
  const visibleConversations = myConversations.filter((conversation) =>
    conversationTitle(conversation, currentUserId, members).toLowerCase().includes(q),
  )
  const visibleGroups = visibleConversations.filter((conversation) => conversation.kind === "group")
  const visibleUsers = members.filter(
    (member) => member.id !== currentUserId && member.name.toLowerCase().includes(q),
  )
  const visibleMeetings = myMeetings.filter((meeting) => meeting.title.toLowerCase().includes(q))

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [selected?.messages.length])

  React.useEffect(() => {
    if (selectedId && !myConversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(null)
    }
  }, [myConversations, selectedId])

  React.useEffect(() => {
    setStagedFiles([])
    setAttachmentPreviewOpen(false)
  }, [selectedId])

  React.useEffect(() => {
    if (!selected) return
    function handlePaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (!clipboard) return
      const directFiles = Array.from(clipboard.files ?? [])
      const itemFiles = Array.from(clipboard.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const seen = new Set<string>()
      const files = [...directFiles, ...itemFiles].filter((file) => {
        if (!file.size) return false
        const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (!files.length) return
      event.preventDefault()
      setStagedFiles((current) => attachmentPreviewOpen ? [...current, ...files] : files)
      setAttachmentPreviewOpen(true)
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [attachmentPreviewOpen, selected])

  React.useEffect(() => {
    if (activeMeetingId && (!activeMeeting || activeMeeting.endedAt)) {
      setActiveMeetingId(null)
    }
  }, [activeMeeting, activeMeetingId])

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const meetingId = new URLSearchParams(window.location.search).get("meeting")
    if (!meetingId) return
    const meeting = chatMeetings.find((item) => item.id === meetingId)
    if (!meeting || meeting.endedAt) return
    if (meetingStatusFor(meeting, currentUserId) === "joined") {
      setActiveMeetingId(meeting.id)
    }
  }, [chatMeetings, currentUserId])

  async function openUser(memberId: string) {
    if (openingUserId) return
    setOpeningUserId(memberId)
    try {
      const id = await ensureDirectConversation(memberId)
      if (id) setSelectedId(id)
    } finally {
      setOpeningUserId(null)
    }
  }

  async function submitMessage() {
    if (!selected || !message.trim() || sending) return
    setSending(true)
    try {
      if (await sendChatMessage(selected.id, message)) setMessage("")
    } finally {
      setSending(false)
    }
  }

  function stageChatFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.size > 0)
    if (!next.length) return
    setStagedFiles(next)
    setAttachmentPreviewOpen(true)
  }

  async function submitMedia(caption: string) {
    if (!selected || !stagedFiles.length || sendingMedia) return
    setSendingMedia(true)
    try {
      const sent = await sendChatMedia(selected.id, stagedFiles, caption)
      if (sent) {
        setStagedFiles([])
        setAttachmentPreviewOpen(false)
      }
    } finally {
      setSendingMedia(false)
    }
  }

  async function openMeeting(meeting: ChatMeeting) {
    if (openingMeetingId || meeting.endedAt) return
    void primeCallAudio()
    const status = meetingStatusFor(meeting, currentUserId)
    if (status === "declined") return

    setOpeningMeetingId(meeting.id)
    try {
      let allowed = true
      if (status === "pending") {
        allowed = await answerMeetingInvite(meeting.id, true)
      } else if (status === "left") {
        allowed = await joinMeeting(meeting.id)
      }
      if (allowed) setActiveMeetingId(meeting.id)
    } finally {
      setOpeningMeetingId(null)
    }
  }

  async function startQuickMeeting(mode: MeetingMode) {
    if (!selected || startingMeetingMode) return
    void primeCallAudio()
    setStartingMeetingMode(mode)
    try {
      const title = conversationTitle(selected, currentUserId, members)
      const id = await createMeeting({
        title: selected.kind === "group" ? title : `Chamada com ${title}`,
        mode,
        memberIds: selected.memberIds,
        conversationId: selected.id,
      })
      if (id) setActiveMeetingId(id)
    } finally {
      setStartingMeetingMode(null)
    }
  }

  const selectedTitle = selected ? conversationTitle(selected, currentUserId, members) : ""
  const selectedMembers = selected
    ? selected.memberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is Member => Boolean(member))
    : []
  const canManageGroup = Boolean(
    selected?.kind === "group" &&
      (currentUserRole === "admin" || selected.createdBy === currentUserId),
  )
  const conversationMeeting = selected
    ? myMeetings.find((meeting) => meeting.conversationId === selected.id && !meeting.endedAt)
    : null

  if (!chatHydrated) {
    return <AppLoadingSkeleton />
  }

  const listItems = tab === "groups" ? visibleGroups : visibleConversations

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8 lg:h-[calc(100dvh-7.4rem)] lg:min-h-[580px]">
        <div className="grid h-full min-h-[640px] grid-cols-1 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_250px]">
          <aside className={cn("min-h-0 flex-col border-r border-border bg-muted/15", selected ? "hidden lg:flex" : "flex")}>
            <div className="border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Chat</p>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Mensagens, grupos e reuniões</p>
                </div>
                <div className="flex items-center gap-1">
                  <MeetingDialog compact onCreated={setActiveMeetingId} />
                  <GroupDialog onSaved={(id) => id && setSelectedId(id)} compact />
                </div>
              </div>

              <label className="relative mt-3 block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar conversa, reunião..."
                  className="h-9 w-full rounded-xl border border-border bg-background pr-3 pl-8 text-xs outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <div className="mt-3 grid grid-cols-4 rounded-xl bg-muted p-1">
                {([
                  ["conversations", "Chats"],
                  ["groups", "Grupos"],
                  ["users", "Usuários"],
                  ["meetings", "Reuniões"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "h-7 min-w-0 rounded-lg px-1 text-[0.58rem] font-medium transition-colors sm:text-[0.62rem]",
                      tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="block truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {tab === "users" ? (
                visibleUsers.length ? (
                  <div className="space-y-1">
                    {visibleUsers.map((member) => {
                      const existing = myConversations.find(
                        (conversation) =>
                          conversation.kind === "direct" && conversation.memberIds.includes(member.id),
                      )
                      return (
                        <button
                          key={member.id}
                          type="button"
                          disabled={Boolean(openingUserId)}
                          onClick={() => void openUser(member.id)}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                        >
                          <MemberAvatar member={member} className="size-9 text-[0.65rem] ring-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{member.name}</span>
                            <span className="block text-[0.62rem] text-muted-foreground">
                              {existing ? "Abrir conversa" : "Iniciar conversa"}
                            </span>
                          </span>
                          <MessageCircleMore className="size-3.5 text-muted-foreground" />
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="px-3 py-10 text-center text-xs text-muted-foreground">Nenhum usuário encontrado.</p>
                )
              ) : tab === "meetings" ? (
                visibleMeetings.length ? (
                  <div className="space-y-1">
                    {visibleMeetings.map((meeting) => (
                      <MeetingListItem
                        key={meeting.id}
                        meeting={meeting}
                        status={meetingStatusFor(meeting, currentUserId)}
                        loading={openingMeetingId === meeting.id}
                        onOpen={() => void openMeeting(meeting)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center">
                    <Radio className="mx-auto size-5 text-muted-foreground/40" />
                    <p className="mt-2 text-xs text-muted-foreground">Nenhuma reunião criada.</p>
                    <div className="mt-3 flex justify-center">
                      <MeetingDialog onCreated={setActiveMeetingId} />
                    </div>
                  </div>
                )
              ) : listItems.length ? (
                <div className="space-y-1">
                  {listItems.map((conversation) => {
                    const title = conversationTitle(conversation, currentUserId, members)
                    const last = conversation.messages.at(-1)
                    const active = conversation.id === selectedId
                    const liveMeeting = myMeetings.some((meeting) => meeting.conversationId === conversation.id && !meeting.endedAt)
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedId(conversation.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                          active ? "bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <div className="relative">
                          <ConversationAvatar conversation={conversation} currentUserId={currentUserId} members={members} />
                          {liveMeeting && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" />}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold">{title}</span>
                            {last && (
                              <time className="shrink-0 font-mono text-[0.56rem] text-muted-foreground">
                                {timeLabel(last.createdAt)}
                              </time>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[0.65rem] text-muted-foreground">
                            {liveMeeting ? "Reunião em andamento" : last?.type === "audio" ? "🎤 Áudio" : last?.content ?? (conversation.kind === "group" ? `${conversation.memberIds.length} participantes` : "Sem mensagens")}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 py-10 text-center">
                  <MessageCircleMore className="mx-auto size-5 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tab === "groups" ? "Nenhum grupo encontrado." : "Nenhuma conversa encontrada."}
                  </p>
                </div>
              )}
            </div>
          </aside>

          <section className={cn("min-h-0 flex-col", selected ? "flex" : "hidden lg:flex")}>
            {selected ? (
              <>
                <header className="flex min-h-16 items-center gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-4">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
                    aria-label="Voltar às conversas"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <ConversationAvatar conversation={selected} currentUserId={currentUserId} members={members} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-sm font-semibold">{selectedTitle}</h1>
                    <p className="truncate text-[0.65rem] text-muted-foreground">
                      {conversationMeeting
                        ? "Reunião em andamento"
                        : selected.kind === "group"
                          ? `${selected.memberIds.length} participantes`
                          : "Conversa individual"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {conversationMeeting ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 px-2 sm:px-3"
                        onClick={() => void openMeeting(conversationMeeting)}
                        title="Entrar na reunião"
                      >
                        <Radio className="size-3.5" />
                        <span className="hidden sm:inline">Entrar</span>
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void startQuickMeeting("audio")}
                          loading={startingMeetingMode === "audio"}
                          title="Iniciar chamada de áudio"
                        >
                          <Phone className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void startQuickMeeting("video")}
                          loading={startingMeetingMode === "video"}
                          title="Iniciar chamada de vídeo"
                        >
                          <Video className="size-4" />
                        </Button>
                      </>
                    )}
                    {selected.kind === "group" && (
                      <GroupDialog group={selected} compact onSaved={(id) => setSelectedId(id)} />
                    )}
                  </div>
                </header>

                {conversationMeeting && (
                  <button
                    type="button"
                    onClick={() => void openMeeting(conversationMeeting)}
                    className="flex items-center gap-3 border-b border-success/20 bg-success/8 px-3 py-2 text-left transition-colors hover:bg-success/12 sm:px-4"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                      {conversationMeeting.mode === "video" ? <Video className="size-3.5" /> : <Headphones className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{conversationMeeting.title}</span>
                      <span className="block text-[0.6rem] text-muted-foreground">Sala aberta · clique para entrar</span>
                    </span>
                    <Radio className="size-3.5 shrink-0 text-success" />
                  </button>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-3 py-4 sm:px-5">
                  {selected.messages.length === 0 ? (
                    <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        {selected.kind === "group" ? <UsersRound className="size-5" /> : <MessageCircleMore className="size-5" />}
                      </span>
                      <p className="mt-3 text-sm font-medium">Comece a conversa</p>
                      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                        Troque mensagens ou inicie uma chamada de áudio/vídeo pelo cabeçalho.
                      </p>
                    </div>
                  ) : (
                    <div className="mx-auto flex max-w-3xl flex-col gap-3">
                      {selected.messages.map((item) => {
                        const sender = members.find((member) => member.id === item.senderId)
                        const own = item.senderId === currentUserId
                        return (
                          <div key={item.id} className={cn("flex items-end gap-2", own && "flex-row-reverse")}>
                            {!own && <MemberAvatar member={sender} className="size-7 ring-0" />}
                            <div className={cn("max-w-[78%]", own && "text-right")}>
                              {!own && selected.kind === "group" && (
                                <p className="mb-1 px-1 text-[0.6rem] font-medium text-muted-foreground">{sender?.name}</p>
                              )}
                              <div
                                className={cn(
                                  "rounded-2xl px-3 py-2 text-left text-sm leading-relaxed",
                                  own
                                    ? "rounded-br-md bg-primary text-primary-foreground"
                                    : "rounded-bl-md bg-card ring-1 ring-foreground/8",
                                )}
                              >
                                {item.type === "audio" ? (
                                  <AudioMessage storagePath={item.mediaPath} durationMs={item.mediaDurationMs} own={own} />
                                ) : item.type === "media" ? (
                                  <ChatMediaMessage
                                    storagePath={item.mediaPath}
                                    name={item.mediaName}
                                    mimeType={item.mediaMimeType}
                                    sizeBytes={item.mediaSizeBytes}
                                    kind={item.mediaKind}
                                    caption={item.content}
                                  />
                                ) : (
                                  <p className="whitespace-pre-wrap break-words">{item.content}</p>
                                )}
                              </div>
                              <time className="mt-1 block px-1 font-mono text-[0.55rem] text-muted-foreground">
                                {new Date(item.createdAt).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                <footer className="border-t border-border bg-card px-3 py-3 sm:px-4">
                  <div className="mx-auto flex max-w-3xl items-end gap-2">
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault()
                          void submitMessage()
                        }
                      }}
                      rows={2}
                      maxLength={2500}
                      placeholder={`Mensagem para ${selectedTitle}...`}
                      className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                    />
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files?.length) stageChatFiles(event.target.files)
                        event.currentTarget.value = ""
                      }}
                    />
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="outline"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={sending || sendingMedia}
                    >
                      <Paperclip className="size-4" />
                      <span className="sr-only">Anexar arquivos</span>
                    </Button>
                    <AudioRecordButton
                      disabled={sending || sendingMedia}
                      onRecorded={(audio, durationMs) => selected ? sendChatAudio(selected.id, audio, durationMs) : Promise.resolve(false)}
                    />
                    <Button type="button" size="icon-lg" onClick={() => void submitMessage()} disabled={!message.trim() || sendingMedia} loading={sending}>
                      <Send className="size-4" />
                      <span className="sr-only">Enviar mensagem</span>
                    </Button>
                  </div>
                  <p className="mx-auto mt-1.5 max-w-3xl text-[0.58rem] text-muted-foreground">Enter envia · Shift + Enter quebra linha · Ctrl+V cola mídia · Segure o microfone por 1s para gravar</p>
                </footer>
              </>
            ) : (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center px-8 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MessageCircleMore className="size-6" />
                </span>
                <h1 className="mt-4 text-lg font-semibold">Central de conversas</h1>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Escolha uma conversa ou crie uma reunião para falar com a equipe por áudio, vídeo ou compartilhamento de tela.
                </p>
                <div className="mt-4">
                  <MeetingDialog onCreated={setActiveMeetingId} />
                </div>
              </div>
            )}
          </section>

          <aside className="hidden min-h-0 border-l border-border bg-muted/10 xl:flex xl:flex-col">
            {selected ? (
              <>
                <div className="border-b border-border px-4 py-4 text-center">
                  <ConversationAvatar conversation={selected} currentUserId={currentUserId} members={members} className="mx-auto size-12" />
                  <p className="mt-2 truncate text-sm font-semibold">{selectedTitle}</p>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                    {selected.kind === "group" ? `${selectedMembers.length} membros` : "Usuário da equipe"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void startQuickMeeting("audio")} loading={startingMeetingMode === "audio"}>
                      <Phone className="size-3.5" /> Áudio
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void startQuickMeeting("video")} loading={startingMeetingMode === "video"}>
                      <Video className="size-3.5" /> Vídeo
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {conversationMeeting && (
                    <button
                      type="button"
                      onClick={() => void openMeeting(conversationMeeting)}
                      className="mb-3 flex w-full items-center gap-2 rounded-xl border border-success/20 bg-success/8 px-3 py-2.5 text-left"
                    >
                      <Radio className="size-4 shrink-0 text-success" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">Reunião ativa</span>
                        <span className="block text-[0.58rem] text-muted-foreground">
                          {meetingStatusFor(conversationMeeting, currentUserId) === "pending" ? "Atender chamada" : "Entrar agora"}
                        </span>
                      </span>
                    </button>
                  )}

                  {selected.kind === "group" ? (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">Participantes</p>
                        {canManageGroup && <GroupDialog group={selected} compact onSaved={(id) => setSelectedId(id)} />}
                      </div>
                      <div className="space-y-1">
                        {selectedMembers.map((member) => (
                          <div key={member.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                            <MemberAvatar member={member} className="size-8 ring-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{member.name}</span>
                              <span className="block text-[0.6rem] text-muted-foreground">
                                {member.id === selected.createdBy ? "Criador do grupo" : member.id === currentUserId ? "Você" : "Membro"}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center">
                      <UserRound className="mx-auto size-4 text-muted-foreground" />
                      <p className="mt-2 text-xs text-muted-foreground">Conversa direta entre dois usuários.</p>
                    </div>
                  )}

                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[0.62rem] font-medium text-muted-foreground">
                      <Clock3 className="size-3.5" /> Reuniões recentes
                    </div>
                    <div className="space-y-1">
                      {myMeetings.filter((meeting) => meeting.conversationId === selected.id).slice(0, 4).map((meeting) => (
                        <div key={meeting.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.62rem]">
                          {meeting.mode === "video" ? <Video className="size-3 text-muted-foreground" /> : <Headphones className="size-3 text-muted-foreground" />}
                          <span className="min-w-0 flex-1 truncate">{meeting.title}</span>
                          <span className={cn("size-1.5 rounded-full", meeting.endedAt ? "bg-muted-foreground/40" : "bg-success")} />
                        </div>
                      ))}
                      {!myMeetings.some((meeting) => meeting.conversationId === selected.id) && (
                        <p className="px-2 py-2 text-[0.6rem] text-muted-foreground">Nenhuma reunião ainda.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Detalhes da conversa aparecem aqui.
              </div>
            )}
          </aside>
        </div>
      </div>

      <ChatAttachmentPreviewDialog
        files={stagedFiles}
        open={attachmentPreviewOpen}
        sending={sendingMedia}
        onOpenChange={(open) => {
          setAttachmentPreviewOpen(open)
          if (!open && !sendingMedia) setStagedFiles([])
        }}
        onFilesChange={setStagedFiles}
        onSend={submitMedia}
      />

      <CallRoom
        meeting={activeMeeting}
        open={Boolean(activeMeeting && !activeMeeting.endedAt)}
        onOpenChange={(next) => {
          if (!next) setActiveMeetingId(null)
        }}
      />
    </>
  )
}
