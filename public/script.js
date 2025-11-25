let problemasCache = [];

/* ----------------------------
   Carregar lista de problemas
-----------------------------*/
async function carregarProblemas() {
    try {
        const res = await fetch("/problemas");
        problemasCache = await res.json();
        renderizarProblemas(problemasCache);
    } catch (error) {
        console.error("Erro ao carregar problemas:", error);
    }
}

/* ----------------------------
   Renderiza Lista
-----------------------------*/
function renderizarProblemas(lista) {
    const div = document.getElementById("listaProblemas");
    div.innerHTML = "";

    if (lista.length === 0) {
        div.innerHTML = '<p style="text-align:center; color:#666; margin-top: 20px;">Nenhum problema encontrado.</p>';
        return;
    }

    lista.forEach(p => {
        const elem = document.createElement("div");
        elem.className = "problema-item";
        
        // Adiciona borda especial para provas
        if(p.dificuldade === 'prova') elem.classList.add('prova-item');
        
        // Se resolvido, adiciona uma classe para estilizar o fundo (opcional)
        if(p.resolvido) elem.classList.add('resolvido-card');

        elem.onclick = () => {
            window.location.href = `/problema.html?id=${p.id}`;
        };

        const diffClass = p.dificuldade; 

        // Ícone de Check se estiver resolvido
        const checkIcon = p.resolvido 
            ? `<i class="fas fa-check-circle" style="color: #10b981; margin-left: auto; font-size: 1.2em;" title="Resolvido"></i>` 
            : '';

        elem.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 6px;">
                <div class="prob-title" style="margin:0;">${p.titulo}</div>
                ${checkIcon}
            </div>

            <div class="prob-tags">
                <span class="diff ${diffClass}">${formatarDificuldade(p.dificuldade)}</span>

                ${p.categoria
                    .map(cat => `<span class="tag ${cat}">${formatarCategoria(cat)}</span>`)
                    .join("")}
            </div>
            
            <p style="margin-top: 8px; font-size: 13px; color: #666;">
                ${p.descricao ? p.descricao.substring(0, 100) + '...' : ''}
            </p>
        `;

        div.appendChild(elem);
    });
}

/* ----------------------------
   Formatadores
-----------------------------*/
function formatarDificuldade(diff) {
    if (diff === "easy") return "Fácil";
    if (diff === "medium") return "Médio";
    if (diff === "hard") return "Difícil";
    if (diff === "prova") return "Prova Antiga";
    return diff;
}

function formatarCategoria(cat) {
    if (cat === "gulosos") return "Guloso";
    if (cat === "dy") return "Prog. Dinâmica";
    if (cat === "dc") return "Divide & Conquer";
    return cat;
}

/* ----------------------------
   Filtro Inteligente
-----------------------------*/
document.addEventListener("click", e => {
    if (e.target.classList.contains("filtro-btn")) {
        
        document.querySelectorAll(".filtro-btn").forEach(btn => btn.classList.remove("active"));
        e.target.classList.add("active");

        const cat = e.target.dataset.cat;
        let filtrados = [];

        if (cat === "all") {
            filtrados = problemasCache;
        } 
        else if (cat === "prova") {
            filtrados = problemasCache.filter(p => p.dificuldade === "prova");
        } 
        else {
            filtrados = problemasCache.filter(p => p.categoria.includes(cat));
        }

        renderizarProblemas(filtrados);
    }
});

// Inicializa
carregarProblemas();