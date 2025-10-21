// O marked.min.js já foi carregado via CDN, a função 'marked' está disponível globalmente.

// --- Variáveis de Estado ---
const apiUrl = 'https://ensina-api.onrender.com';
let messages = [];
let abortController = null;
let isGenerating = false;
let isTyping = false;
let newMessage = '';

// --- Referências do DOM ---
const messagesContainer = document.getElementById('messages-container');
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send-button');
const stopButton = document.getElementById('stop-button');
const typingIndicator = document.getElementById('typing-indicator');
const composerForm = document.getElementById('composer-form');

// --- Funções Auxiliares ---

/**
 * Atualiza o estado dos botões e a visibilidade do indicador de digitação.
 */
function updateUIState() {
    isTyping = isGenerating;
    sendButton.disabled = !newMessage.trim() || isGenerating;
    stopButton.disabled = !isGenerating;
    typingIndicator.style.display = isTyping ? 'flex' : 'none';
}

/**
 * Renderiza todas as mensagens no container.
 */
function renderMessages() {
    // Primeiro, limpa o container atual
    messagesContainer.innerHTML = '';
    
    if (messages.length === 0) {
        // Estado vazio
        messagesContainer.innerHTML = `
            <div class="empty-state">
                <p>Comece a conversar com o modelo — digite uma pergunta abaixo.</p>
            </div>
        `;
        return;
    }

    // Renderiza as mensagens
    messages.forEach((msg, i) => {
        // O texto do avatar (Assistente/Usuário) é mantido.
        const roleText = msg.role === 'user' ? 'Usuário' : 'Assistente';
        const avatarClass = msg.role === 'user' ? 'avatar-user' : 'avatar-assistant';

        // O conteúdo do assistente já deve estar em HTML seguro
        const contentHtml = msg.role === 'assistant'
            ? `<div class="message-content">${msg.htmlContent || ''}</div>`
            : `<div class="message-content">${msg.content}</div>`;

        // Ações da mensagem
        const actionsHtml = `
            <div class="message-actions">
                <button
                    class="btn tiny"
                    onclick="copyMessage('${btoa(msg.content)}') /* btoa para codificar */"
                    title="Copiar texto original"
                    aria-label="Copiar mensagem"
                >
                    Copiar
                </button>
                ${msg.role === 'user' ? `
                    <button
                        class="btn tiny"
                        onclick="editMessage(${i})"
                        title="Editar"
                        aria-label="Editar mensagem"
                    >
                        Editar
                    </button>
                ` : ''}
            </div>
        `;

        const messageHtml = `
            <article class="message" data-role="${msg.role}" data-index="${i}" role="article">
                <div class="avatar" aria-hidden="true">
                    <span class="${avatarClass}">${roleText}</span>
                </div>
                <div class="message-body">
                    <div class="message-meta">
                        <time class="time" style="margin-left: auto;">${msg.time}</time> 
                    </div>

                    ${contentHtml}
                    ${actionsHtml}
                </div>
            </article>
        `;

        messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
    });

    // Rola para o final
    messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
}

/**
 * Converte o tempo para uma string legível.
 */
function getTimeString() {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// --- Funções de Ação do Chat ---

/**
 * Reseta o chat no backend (como em ngOnInit).
 */
async function resetChatOnServer() {
    try {
        await fetch(`${apiUrl}/api/reset`);
        console.log('Chat resetado no backend.');
    } catch (error) {
        console.error('Falha ao resetar o chat no backend:', error);
    }
}

/**
 * Envia a mensagem do usuário.
 * @param {string} text O texto da mensagem do usuário.
 */
function sendMessage(text) {
    const trimmedText = (text || '').trim();
    if (!trimmedText || isGenerating) return;

    // 1. Adiciona a mensagem do usuário
    messages.push({
        role: 'user',
        content: trimmedText,
        time: getTimeString(),
    });

    // 2. Limpa o input
    promptInput.value = '';
    newMessage = '';

    // 3. Atualiza a UI e inicia o streaming
    renderMessages();
    streamAssistantResponse(trimmedText);
}

/**
 * Função principal para streaming da resposta do assistente.
 * @param {string} userText O texto da última mensagem do usuário.
 */
async function streamAssistantResponse(userText) {
    // 1. Configura o estado de geração
    isGenerating = true;
    updateUIState();

    // 2. Cancela qualquer geração anterior
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();

    // 3. Cria e adiciona a mensagem do assistente
    const assistantMessage = {
        role: 'assistant',
        content: '',
        htmlContent: '',
        time: getTimeString(),
    };
    messages.push(assistantMessage);
    renderMessages();

    try {
        const response = await fetch(`${apiUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userText }),
            signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
            throw new Error(`Erro na requisição: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamDone = false;

        // Otimização: Acompanha o index da mensagem atual para re-renderização
        const currentMessageIndex = messages.length - 1;

        while (!streamDone) {
            const { value, done } = await reader.read();
            if (done) {
                streamDone = true;
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const events = chunk.split('\n\n').filter(Boolean);

            for (const event of events) {
                if (event.startsWith('event: message')) {
                    const dataLine = event.split('\n').find(line => line.startsWith('data:'));
                    if (dataLine) {
                        const payload = JSON.parse(dataLine.substring(5));
                        
                        // 1. Adiciona o novo texto (markdown)
                        assistantMessage.content += payload.text;

                        // 2. Converte todo o markdown acumulado para HTML
                        const rawHtml = marked.parse(assistantMessage.content); 

                        // 3. Atualiza o HTML
                        assistantMessage.htmlContent = rawHtml;

                        // Rerenderiza APENAS o conteúdo da última mensagem para otimização
                        const lastMessageElement = document.querySelector(`.message[data-index="${currentMessageIndex}"] .message-content`);
                        if (lastMessageElement) {
                            lastMessageElement.innerHTML = assistantMessage.htmlContent;
                            // Rola para o final após a atualização do conteúdo
                            messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
                        } else {
                            // Se o elemento não existe (primeira vez), faz a renderização completa
                            renderMessages();
                        }
                    }
                } else if (event.startsWith('event: done')) {
                    streamDone = true;
                    break;
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            assistantMessage.content += '\n\n(Geração interrompida)';
            console.log('Stream foi cancelado pelo usuário.');
        } else {
            assistantMessage.content += '\n\n(Ocorreu um erro ao obter a resposta)';
            console.error('Erro durante o streaming da resposta:', error);
        }
        // Atualiza o HTML uma última vez para exibir a mensagem de erro/interrupção
        assistantMessage.htmlContent = marked.parse(assistantMessage.content);
        renderMessages();
    } finally {
        isGenerating = false;
        abortController = null;
        updateUIState();
    }
}

/**
 * Função para parar a geração de resposta.
 */
function stopGeneration() {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    isGenerating = false;
    updateUIState();
}


// --- Funções de Manipulação da Mensagem (Globais para serem chamadas pelo onclick) ---

/**
 * Copia o texto da mensagem (decodifica a string base64).
 * @param {string} encodedText Texto codificado em base64.
 */
window.copyMessage = (encodedText) => {
    try {
        const text = atob(encodedText); // Decodifica de base64
        if (!text) return;
        navigator.clipboard.writeText(text).catch((err) => {
            console.error('Falha ao copiar texto:', err);
        });
    } catch (e) {
        console.error('Erro ao decodificar ou copiar texto.', e);
    }
};

/**
 * Edita uma mensagem do usuário (move o conteúdo para o input).
 * @param {number} index Índice da mensagem.
 */
window.editMessage = (index) => {
    const msg = messages[index];
    if (!msg || msg.role !== 'user' || isGenerating) return;

    // Move o conteúdo para o input
    promptInput.value = msg.content;
    newMessage = msg.content;
    
    // Remove a mensagem da lista
    messages.splice(index, 1);
    
    // Rerenderiza o chat e atualiza o estado
    renderMessages();
    updateUIState();
};

// --- Listeners de Eventos ---

// 1. Enviar a mensagem (submit do formulário, que é acionado por Enter)
composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(promptInput.value);
});

// 2. DETECTA ENTER: Adiciona a funcionalidade de enviar ao pressionar ENTER
promptInput.addEventListener('keydown', (e) => {
    // Se a tecla pressionada for ENTER (key code 13 ou 'Enter')
    // E se SHIFT não estiver pressionado (para permitir que Shift + Enter insira nova linha)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Impede o comportamento padrão do textarea (inserir nova linha)
        
        // Verifica se a mensagem não está vazia e se não está gerando
        if (newMessage.trim() && !isGenerating) {
            sendMessage(promptInput.value);
        }
    }
    // Caso contrário (como Shift+Enter), o comportamento padrão (nova linha) é permitido.
});

// 3. Atualizar o estado do input e o botão de envio
promptInput.addEventListener('input', () => {
    newMessage = promptInput.value;
    updateUIState();
});

// 4. Parar a geração
stopButton.addEventListener('click', stopGeneration);

// --- Inicialização ---

document.addEventListener('DOMContentLoaded', () => {
    resetChatOnServer(); // Reseta no backend ao carregar
    renderMessages(); // Exibe o estado vazio inicial
    updateUIState(); // Configura o estado inicial dos botões
});