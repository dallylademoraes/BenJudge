async function loadStats() {
    const me = await (await fetch("/me")).json();

    document.getElementById("xpTotal").innerText = me.xp;
    document.getElementById("nivelUser").innerText = me.nivel;
    document.getElementById("pontosUser").innerText = me.pontuacao;
}

async function loadAcertos() {
    const res = await fetch("/dashboard/acertos");
    const dados = await res.json();

    const ctx = document.getElementById("graficoAcertos");

    new Chart(ctx, {
        type: "pie",
        data: {
            labels: ["Acertos", "Erros"],
            datasets: [{
                data: [dados.acertos, dados.erros],
                backgroundColor: ["#4caf50", "#f44336"]
            }]
        }
    });
}

async function loadXP() {
    const res = await fetch("/dashboard/xp");
    const lista = await res.json();

    const dias = lista.map(l => l.criado_em.split("T")[0]);
    const valores = lista.map(l => l.xp);

    const ctx = document.getElementById("graficoXP");

    new Chart(ctx, {
        type: "line",
        data: {
            labels: dias,
            datasets: [{
                label: "XP ganho",
                data: valores
            }]
        }
    });
}

async function loadEnvios() {
    const res = await fetch("/dashboard/envios");
    const lista = await res.json();

    const div = document.getElementById("listaEnvios");

    lista.forEach(e => {
        const linha = document.createElement("div");
        linha.className = "envioItem";
        linha.innerHTML = `
            Problema ${e.problema_id} — ${e.correta ? "✔️" : "❌"}  
            <small>${new Date(e.criado_em).toLocaleString()}</small>
        `;
        div.appendChild(linha);
    });
}

loadStats();
loadAcertos();
loadXP();
loadEnvios();
