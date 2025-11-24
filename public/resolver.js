let editor;
const problemaId = new URLSearchParams(window.location.search).get("id");

// Variável global para o editor da solução (NOVO)
let solucaoEditor; 

// Configuração do Monaco Editor
require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.37.1/min/vs" } });

require(["vs/editor/editor.main"], () => {
    // Detecta o tema, garantindo que o editor seja criado corretamente
    const tema = localStorage.getItem("temaBenJudge") === "dark" ? "vs-dark" : "vs-light";

    editor = monaco.editor.create(document.getElementById("editor"), {
        value: "",
        language: "plaintext",
        theme: tema,
        fontSize: 16,
        minimap: { enabled: false }
    });

    carregarProblema();
    
    // Configura o listener do chat (Enter key)
    document.getElementById("chatInput").addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            enviarMensagemChat();
        }
    });

    // Configura o listener do botão de envio do chat
    document.getElementById("enviarChat").onclick = enviarMensagemChat;
});

// --- Lógica de Carregamento Inicial (Gemini 1 - Descrição) ---
async function carregarProblema() {
    try {
        const res = await fetch(`/problemas/${problemaId}`);
        const problema = await res.json();

        document.getElementById("problemaTitulo").innerText = problema.titulo;
        
        // 1. Carrega a descrição do problema
        document.getElementById("problemaDescricao").innerText = problema.descricao;
        
        // 2. Inicia o chat com a primeira mensagem do Gemini (opcional)
        // adicionarMensagem("gemini", "Olá! Posso te ajudar a entender melhor este problema. Pergunte-me sobre os requisitos, exemplos ou a lógica por trás dele!");
        
    } catch (error) {
        console.error("Erro ao carregar problema:", error);
        document.getElementById("problemaDescricao").innerText = "Erro ao carregar o problema.";
    }
}

// --- Lógica do Chat Interativo (Gemini 1 - Ajuda) ---
function adicionarMensagem(autor, texto) {
    const chatContainer = document.getElementById("mensagensChat");
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("chat-message", `${autor}-message`);
    msgDiv.innerText = texto;
    chatContainer.appendChild(msgDiv);
    
    // Rola para baixo automaticamente
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function enviarMensagemChat() {
    const inputElement = document.getElementById("chatInput");
    const pergunta = inputElement.value.trim();

    if (!pergunta) return;

    // Adiciona a pergunta do usuário
    adicionarMensagem("user", pergunta);
    inputElement.value = ""; // Limpa o input

    // Exibe um indicador de "digitando" (opcional)
    adicionarMensagem("gemini", "...");

    try {
        // Endpoint do seu backend para o Gemini do chat (Gemini 1)
        const res = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                problema_id: Number(problemaId), // Envia o ID para contexto
                pergunta: pergunta
            })
        });

        const out = await res.json();
        
        // Remove o indicador de "digitando"
        const chatContainer = document.getElementById("mensagensChat");
        chatContainer.removeChild(chatContainer.lastChild); 

        // Adiciona a resposta do Gemini
        adicionarMensagem("gemini", out.resposta || "Não foi possível obter uma resposta do Gemini.");

    } catch (error) {
        console.error("Erro no chat com Gemini:", error);
        
        const chatContainer = document.getElementById("mensagensChat");
        chatContainer.removeChild(chatContainer.lastChild); 
        
        adicionarMensagem("gemini", "Desculpe, houve um erro ao comunicar com o servidor.");
    }
}

// --- Lógica de Envio de Solução (Gemini 2 - Code Review) ---
document.getElementById("enviarSolucao").onclick = async () => {
    const texto = editor.getValue();
    const feedbackElement = document.getElementById("feedback");
    
    feedbackElement.innerText = "Enviando solução para correção... Aguarde."; // Feedback de carregamento

    try {
        // Endpoint do seu backend para o Gemini do Code Review (Gemini 2)
        const res = await fetch("/corrigir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                problema_id: Number(problemaId),
                resposta_usuario: texto
            })
        });

        const out = await res.json();
        
        // Exibe o feedback do Code Review
        feedbackElement.innerText = out.avaliacao || out.erro || "Erro inesperado na correção.";
        
    } catch (error) {
        console.error("Erro no envio da solução:", error);
        feedbackElement.innerText = "Erro de conexão ou servidor ao tentar corrigir a solução.";
    }
};

// --- Lógica de Mostrar Solução e Comparação (Gemini 3) ---
document.getElementById("mostrarSolucao").onclick = async () => {
    const textoAtual = editor.getValue();
    
    // ATENÇÃO: Os IDs abaixo dependem do seu HTML estar atualizado!
    const solucaoContainer = document.getElementById("solucaoContainer"); // Novo container pai
    const analiseSolucao = document.getElementById("analiseSolucao"); 
    
    solucaoContainer.style.display = "block"; // Torna o container visível
    analiseSolucao.innerHTML = `
        <h3>🔎 Análise e Solução Detalhada (Gemini)</h3>
        <p>Aguarde enquanto a solução é carregada...</p>
    `; 

    try {
        const res = await fetch("/revelar-solucao", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                problema_id: Number(problemaId),
                resposta_usuario: textoAtual
            })
        });

        const out = await res.json();
        
        if (out.erro) {
            analiseSolucao.innerHTML = `<h3>Erro</h3><p>${out.erro}</p>`;
            document.getElementById("editorSolucao").style.display = 'none';
            return;
        }

        // O backend está enviando JSON com 'solucao' (código) e 'analise' (texto)
        
        // 1. Injeta a análise (texto)
        analiseSolucao.innerHTML = `
            <h3>✅ Análise de Falta:</h3>
            <p>${out.analise}</p>
            <h3>Código Solução Ideal:</h3>
        `;
        document.getElementById("editorSolucao").style.display = 'block';

        // O Gemini geralmente usa Python ou JavaScript. Assumindo Python com base no seu log.
        const linguagem = "python"; 

        // 2. Inicializa ou atualiza o Monaco Editor da solução (código)
        if (solucaoEditor) {
            solucaoEditor.setValue(out.solucao);
            monaco.editor.setModelLanguage(solucaoEditor.getModel(), linguagem);
        } else {
            // Inicializa um novo editor para a solução
            solucaoEditor = monaco.editor.create(document.getElementById("editorSolucao"), {
                value: out.solucao,
                language: linguagem,
                theme: localStorage.getItem("temaBenJudge") === "dark" ? "vs-dark" : "vs-light",
                readOnly: true, // Editor da solução é somente leitura
                minimap: { enabled: false },
                fontSize: 14 
            });
        }
        
    } catch (error) {
        console.error("Erro ao mostrar solução:", error);
        // Garante que o container de solução apareça mesmo com erro
        solucaoContainer.style.display = "block"; 
        analiseSolucao.innerHTML = `<h3>Erro de Conexão</h3><p>Erro de conexão ao tentar revelar a solução.</p>`;
    }
};