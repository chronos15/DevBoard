export type ErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
  status?: unknown
  name?: unknown
}

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === "object") return error as ErrorLike
  if (typeof error === "string") return { message: error }
  return {}
}

export function rawErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.trim()
  const value = asErrorLike(error).message
  return typeof value === "string" ? value.trim() : ""
}

function errorCode(error: unknown) {
  const value = asErrorLike(error).code
  return typeof value === "string" ? value.trim() : ""
}

function errorName(error: unknown) {
  if (error instanceof Error && error.name) return error.name
  const value = asErrorLike(error).name
  return typeof value === "string" ? value.trim() : ""
}

function looksAlreadyFriendly(message: string) {
  if (!message) return false
  if (/duplicate key|violates .*constraint|permission denied|row-level security|schema cache|does not exist|invalid input syntax|foreign key|not-null|jwt|sqlstate|pgrst|failed to fetch|networkerror|load failed|typeerror|referenceerror|is not a function|new row violates|could not find|unexpected token|websocket|realtime|supabase|storage bucket|bucket not found/i.test(message)) return false
  return /^(não|nao|informe|selecione|apenas|já|ja|use|confirme|finalize|justifique|responsável|responsavel|projeto|atividade|subatividade|solicitação|solicitacao|arquivo|a imagem|o arquivo|sem acesso|você|voce|nenhum|nenhuma|este|esta|essa|esse|falha ao|não foi possível|nao foi possivel|muitos|sua sessão|sua sessao|e-mail|email|senha|conta|reunião|reuniao|câmera|camera|microfone|compartilhamento|o sistema|o recurso|a operação|a operacao)/i.test(message)
}

/**
 * Converte erros de infraestrutura/banco/autenticação em mensagens adequadas à UI.
 * O detalhe técnico continua disponível no console para diagnóstico, mas nunca deve
 * ser exibido diretamente ao usuário final.
 */
export function toUserFacingError(error: unknown, fallback = "Não foi possível concluir a operação.") {
  const message = rawErrorMessage(error)
  const code = errorCode(error)
  const name = errorName(error)
  const full = `${code} ${name} ${message}`.trim()

  // Solicitações: a numeração da OS é independente por unidade.
  if (/service_requests_workspace_unit_order_uidx/i.test(full)) {
    return "Já existe uma solicitação com esse número de OS na unidade selecionada. Abra o protocolo existente ou informe outro número."
  }
  // Ambiente ainda sem a migration que migra a unicidade global para por unidade.
  if (/service_requests_workspace_order_uidx/i.test(full)) {
    return "A numeração independente por unidade ainda não está ativa neste ambiente. Atualize o sistema e tente novamente."
  }

  // Autenticação / e-mail.
  if (/email rate limit|rate limit.*email|too many.*email|over_email_send_rate_limit/i.test(full)) {
    return "Muitos e-mails foram enviados em pouco tempo. Aguarde alguns minutos e tente novamente."
  }
  if (/user already registered|already been registered|email.*already.*registered/i.test(full)) {
    return "Já existe uma conta cadastrada com este e-mail."
  }
  if (/invalid login credentials|invalid.*credentials/i.test(full)) return "E-mail ou senha inválidos."
  if (/email not confirmed|email_not_confirmed/i.test(full)) return "Confirme seu e-mail antes de entrar no TaskBoard."
  if (/signup.*disabled|signups not allowed/i.test(full)) return "A criação de novas contas está temporariamente desabilitada."
  if (/password.*at least|weak_password|password should/i.test(full)) return "A senha não atende aos requisitos mínimos de segurança."
  if (/same_password/i.test(full)) return "A nova senha precisa ser diferente da senha atual."
  if (/token.*expired|jwt.*expired|refresh.*token.*not found|invalid refresh token/i.test(full)) return "Sua sessão expirou. Entre novamente para continuar."

  // Navegador / mídia.
  if (/NotAllowedError|permission denied.*(camera|microphone)|permission.*denied.*media/i.test(full)) {
    return "Permita o acesso à câmera e ao microfone no navegador para participar da reunião."
  }
  if (/NotFoundError|requested device not found|devices not found/i.test(full)) {
    return "Não encontrei uma câmera ou microfone disponível neste dispositivo."
  }
  if (/NotReadableError|device.*in use|could not start video source/i.test(full)) {
    return "A câmera ou o microfone parece estar em uso por outro aplicativo. Feche-o e tente novamente."
  }
  if (/OverconstrainedError|constraint.*device|constraints could not be satisfied/i.test(full)) {
    return "Não foi possível usar a câmera ou o microfone com as configurações atuais."
  }

  // Rede / indisponibilidade temporária.
  if (/failed to fetch|network request failed|networkerror|load failed|fetch failed|connection.*failed|ERR_NETWORK/i.test(full)) {
    return "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente."
  }
  if (/57014|statement timeout|timeout|timed out/i.test(full)) {
    return "A operação demorou mais do que o esperado. Tente novamente em instantes."
  }
  if (/53300|too many connections|service unavailable|temporarily unavailable/i.test(full)) {
    return "O serviço está temporariamente ocupado. Aguarde alguns instantes e tente novamente."
  }

  // PostgreSQL / PostgREST / políticas.
  if (/permission denied for function is_workspace_admin/i.test(full)) {
    return "As permissões administrativas deste ambiente precisam ser atualizadas. Atualize o TaskBoard e tente novamente."
  }
  if (code === "23505" || /duplicate key value|unique constraint|already exists/i.test(full)) {
    return "Já existe um registro com essas informações. Revise os dados e tente novamente."
  }
  if (code === "23503" || /foreign key constraint/i.test(full)) {
    return "Este item está sendo usado em outro lugar e não pode ser alterado ou excluído agora."
  }
  if (code === "23502" || code === "23514" || code === "22P02" || /not-null constraint|check constraint|invalid input syntax/i.test(full)) {
    return "Alguns dados informados são inválidos. Revise os campos e tente novamente."
  }
  if (code === "22001" || /value too long|string data.*right truncation/i.test(full)) {
    return "Um dos campos ultrapassou o tamanho permitido. Reduza o conteúdo e tente novamente."
  }
  if (code === "42501" || /permission denied|row-level security|new row violates row-level security|not authorized|unauthorized/i.test(full)) {
    return "Você não tem permissão para realizar esta ação."
  }
  if (["42P01", "42703", "42883", "PGRST202", "PGRST204"].includes(code) || /schema cache|could not find the function|does not exist|undefined column|undefined function/i.test(full)) {
    return "Este recurso ainda não está disponível no ambiente atual. Atualize o TaskBoard e tente novamente."
  }
  if (/bucket not found|storage.*not found/i.test(full)) {
    return "O envio de arquivos ainda não está disponível neste ambiente."
  }
  if (/payload too large|entity too large|file.*too large/i.test(full)) {
    return "O arquivo é maior que o limite permitido. Escolha um arquivo menor e tente novamente."
  }
  if (/object already exists|resource already exists/i.test(full)) {
    return "Já existe um arquivo com esse nome. Renomeie o arquivo e tente novamente."
  }

  // WebRTC / tempo real.
  if (/setRemoteDescription|setLocalDescription|ICE|peer connection|webrtc|realtime.*(channel|authorization|signal)/i.test(full)) {
    return "Não foi possível estabelecer a conexão da reunião. Tente entrar novamente."
  }

  // Erros de programação nunca devem vazar para a interface.
  if (/typeerror|referenceerror|syntaxerror|is not a function|cannot read properties|undefined is not|null is not|unexpected token/i.test(full)) {
    return "Ocorreu um erro inesperado nesta tela. Atualize a página e tente novamente."
  }

  if (looksAlreadyFriendly(message)) return message
  return fallback.endsWith(".") ? fallback : `${fallback}.`
}
