let problemasCache = [];

/* ----------------------------
   Carregar lista de problemas
-----------------------------*/
async function carregarProblemas() {
    const res = await fetch("/problemas");
    problemasCache = await res.json();
    renderizarProblemas(problemasCache);
}

/* ----------------------------
   Renderiza Lista
-----------------------------*/
function renderizarProblemas(lista) {
    const div = document.getElementById("listaProblemas");
    div.innerHTML = "";

    lista.forEach(p => {
        const elem = document.createElement("div");
        elem.className = "problema-item";
        elem.onclick = () => {
            window.location.href = `/problema.html?id=${p.id}`;
        };

        elem.innerHTML = `
            <div class="prob-title">${p.id}. ${p.titulo}</div>

            <div class="prob-tags">
                <span class="diff ${p.dificuldade}">${formatarDificuldade(p.dificuldade)}</span>

                ${p.categoria
                    .map(cat => `<span class="tag ${cat}">${formatarCategoria(cat)}</span>`)
                    .join("")}
            </div>
        `;

        div.appendChild(elem);
    });
}

/* Nome bonito da dificuldade */
function formatarDificuldade(diff) {
    if (diff === "easy") return "Fácil";
    if (diff === "medium") return "Médio";
    if (diff === "hard") return "Difícil";
    return diff;
}


/* ----------------------------
   Formata nome da categoria
-----------------------------*/
function formatarCategoria(cat) {
    if (cat === "gulosos") return "Guloso";
    if (cat === "dy") return "Prog. Dinâmica";
    if (cat === "dc") return "Divide & Conquer";
}

/* ----------------------------
   Filtro de categorias
-----------------------------*/
document.addEventListener("click", e => {
    if (e.target.classList.contains("filtro-btn")) {
        document.querySelectorAll(".filtro-btn").forEach(btn => btn.classList.remove("active"));
        e.target.classList.add("active");

        const cat = e.target.dataset.cat;

        if (cat === "all") {
            renderizarProblemas(problemasCache);
        } else {
            const filtrados = problemasCache.filter(p => p.categoria.includes(cat));
            renderizarProblemas(filtrados);
        }
    }
});

/* ---------------------------- */
carregarProblemas();
