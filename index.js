import * as dotenv from "dotenv";
dotenv.config({ override: true });

console.log("==== SUPABASE PROJETO ATUAL ====");
console.log("URL:", process.env.SUPABASE_URL);
console.log("SERVICE_ROLE:", process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.slice(0, 20) + "..." : "(não definido)");
console.log("===============================");

import express from "express";
import fs from "fs";
import axios from "axios";
import cookieParser from "cookie-parser";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

/* ============================================
    CACHE EM MEMÓRIA (Para evitar cobranças)
============================================ */
const apiCache = {}; 
const CACHE_EXPIRATION_TIME = 3600000; // 1 hora em milissegundos

/** Cria uma chave única baseada no endpoint, ID do problema e o conteúdo da requisição. */
const cacheKey = (endpoint, problema_id, content = '') => 
    `${endpoint}_${problema_id}_${content.slice(0, 50).replace(/\s/g, '_')}`;

/** Verifica o cache antes de fazer a chamada à API. */
const cacheCheck = (key, res) => {
    const entry = apiCache[key];
    if (entry && (Date.now() < entry.expires)) {
        console.log(`[CACHE HIT] Retornando resposta para ${key}`);
        res.json(entry.data);
        return true;
    }
    return false;
};

/** Salva a resposta no cache com tempo de expiração. */
const cacheStore = (key, data) => {
    apiCache[key] = {
        data,
        expires: Date.now() + CACHE_EXPIRATION_TIME
    };
};

/* ============================================
    SUPABASE CLIENT
============================================ */
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

/* ============================================
    CARREGAR PROBLEMAS
============================================ */
let problemas = [];
try {
    problemas = JSON.parse(fs.readFileSync("./problemas.json", "utf-8"));
} catch (err) {
    console.error("Erro ao ler problemas.json:", err.message);
}

/* ============================================
    USUÁRIO AUTOMÁTICO
============================================ */
app.use(async (req, res, next) => {
    if (!req.cookies.benjudge_user) {
        const { data, error } = await supabase
            .from("usuarios")
            .insert({})
            .select()
            .single();

        if (error) {
            console.error("Erro criando usuário:", error);
            return res.status(500).json({ erro: "Falha ao criar usuário" });
        }

        res.cookie("benjudge_user", data.id, {
            httpOnly: true,
            sameSite: "lax"
        });

        req.usuario_id = data.id;
    } else {
        req.usuario_id = req.cookies.benjudge_user;
    }

    next();
});

/* ============================================
    LISTAR PROBLEMAS
============================================ */
app.get("/problemas", (req, res) => {
    res.json(problemas);
});

/* ============================================
    PROBLEMA ESPECÍFICO
============================================ */
app.get("/problemas/:id", (req, res) => {
    const problema = problemas.find(p => p.id == req.params.id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    res.json(problema);
});

/* ============================================
    PERFIL DO USUÁRIO
============================================ */
app.get("/me", async (req, res) => {
    const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq("id", req.usuario_id)
        .single();

    if (error)
        return res.status(500).json({ erro: "Erro ao buscar usuário" });

    res.json(data);
});

/* ============================================
    CHAT INTERATIVO (GEMINI 1 - AJUDA)
============================================ */
app.post("/chat", async (req, res) => {
    const { problema_id, pergunta } = req.body;
    const cacheKeyChat = cacheKey('chat', problema_id, pergunta);

    // 🌟 1. VERIFICA O CACHE
    if (cacheCheck(cacheKeyChat, res)) return;

    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    // ======================
    // PROMPT DE AJUDA OTIMIZADO (Redução de Tokens de Entrada)
    // ======================
    const promptAjuda = `
Você é um assistente de programação prestativo e didático.
Sua função é APENAS ajudar o usuário a entender o problema e a pensar na solução, sem dar a resposta direta.
NÃO forneça código ou a solução completa. Mantenha as respostas focadas no conceito e na lógica.
Seja o mais breve e direto possível, com no máximo 50 palavras.

PROBLEMA (foco na descrição para reduzir tokens de entrada):
${problema.descricao}

PERGUNTA DO USUÁRIO:
${pergunta}
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [
                    {
                        parts: [{ text: promptAjuda }]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 1500
                }
            }
        );

        const texto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!texto) {
            console.error("Gemini retornou texto vazio ou bloqueado. Resposta da API:", JSON.stringify(resposta.data, null, 2));
        }

        const respostaFinal = texto || "Erro ao obter ajuda do Gemini. (Verifique o log do servidor para detalhes.)";
        const responseData = { resposta: respostaFinal };
        
        // 🌟 2. ARMAZENA NO CACHE
        cacheStore(cacheKeyChat, responseData);

        res.json(responseData);

    } catch (erro) {
        console.error("Erro no Gemini Chat (Catch):", erro.response?.data || erro);
        res.status(500).json({
            erro: "Erro ao consultar Gemini para ajuda",
            detalhe: erro.message
        });
    }
});

/* ============================================
    CORRIGIR SOLUÇÃO (GEMINI 2 - CODE REVIEW)
============================================ */
app.post("/corrigir", async (req, res) => {
    // Não há cache aqui pois a correção depende do código UNICO do usuário.
    const { problema_id, resposta_usuario } = req.body;
    const usuario_id = req.usuario_id;

    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    // ======================
    // PROMPT SEGURO
    // ======================
    const promptSeguro = `
Você é um corretor de provas de algoritmos.
NÃO forneça código, NÃO forneça solução completa e NÃO mostre como resolver passo a passo.

Avalie a resposta do aluno.
Retorne EXATAMENTE:
- "correto" ou "incorreto"
- Nota de 0 a 10
- Pequena justificativa (sem ensinar)
- Uma dica curta (sem dar a solução)

PROBLEMA:
${JSON.stringify(problema, null, 2)}

RESPOSTA DO ALUNO:
${resposta_usuario}
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [
                    {
                        parts: [{ text: promptSeguro }]
                    }
                ]
            }
        );

        const texto =
            resposta.data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Erro ao interpretar resposta do Gemini.";

        const correta = texto.toLowerCase().includes("correto");

        /* ======================
            LÓGICA DE PERSISTÊNCIA (XP, PONTUAÇÃO, ETC.)
        ====================== */
        let xp_ganho = correta ? 50 : 10;

        const { data: tentativas } = await supabase
            .from("envios")
            .select("*")
            .eq("usuario_id", usuario_id)
            .eq("problema_id", problema_id);

        if (!tentativas || tentativas.length === 0) xp_ganho += 30;

        await supabase.from("envios").insert({
            usuario_id,
            problema_id,
            resposta: resposta_usuario,
            correta,
            nota: correta ? 10 : 0
        });

        await supabase.rpc("incrementar_xp", {
            usuario_id_param: usuario_id,
            quantidade: xp_ganho
        });

        if (correta) {
            await supabase.rpc("incrementar_pontuacao", {
                usuario_id_param: usuario_id,
                quantidade: 1
            });
        }
        /* ======================
            FIM DA LÓGICA DE PERSISTÊNCIA
        ====================== */

        res.json({
            avaliacao: texto,
            correta,
            xp_ganho
        });

    } catch (erro) {
        console.error("Erro Gemini:", erro.response?.data || erro);
        res.status(500).json({
            erro: "Erro ao consultar Gemini",
            detalhe: erro.message
        });
    }
});

/* ============================================
    REVELAR SOLUÇÃO E COMPARAÇÃO (GEMINI 3)
============================================ */
app.post("/revelar-solucao", async (req, res) => {
    const { problema_id, resposta_usuario } = req.body; 
    const cacheKeySolucao = cacheKey('solucao', problema_id);
    
    // 🌟 1. VERIFICA O CACHE
    if (cacheCheck(cacheKeySolucao, res)) return; 
    
    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    const promptSolucao = `
Você é um tutor de programação. Sua tarefa é fornecer a solução ideal para o problema e, em seguida, comparar essa solução com o código submetido pelo aluno.

Para garantir o processamento correto, você deve retornar a resposta no formato JSON.
Retorne EXATAMENTE UM objeto JSON com duas chaves:
1.  **analise**: Explicação concisa (máximo 150 palavras) do que faltou no código do aluno, focada em lógica e conceitos.
2.  **solucao_codigo**: A solução ideal completa do problema. Use o código em JavaScript ou Python.

NÃO retorne nenhum texto antes ou depois do objeto JSON.

PROBLEMA:
${JSON.stringify(problema, null, 2)}

CÓDIGO ATUAL DO ALUNO:
${resposta_usuario || "O aluno ainda não tentou submeter um código."}
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [
                    {
                        parts: [{ text: promptSolucao }]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 2500 
                }
            }
        );
        
        const textoBruto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        const jsonMatch = textoBruto ? textoBruto.match(/\{[\s\S]*\}/) : null;
        
        if (!jsonMatch) {
            console.error("Gemini não retornou o objeto JSON formatado. Resposta bruta:", textoBruto);
            return res.status(500).json({ erro: "Erro de formatação do Gemini (Esperado JSON)." });
        }
        
        let dados;
        try {
            dados = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("Erro ao fazer parsing do JSON:", e);
            return res.status(500).json({ erro: "Erro de parsing do JSON do Gemini." });
        }
        
        const responseData = {
            solucao: dados.solucao_codigo,
            analise: dados.analise
        };

        // 🌟 2. ARMAZENA NO CACHE
        cacheStore(cacheKeySolucao, responseData);

        res.json(responseData);

    } catch (erro) {
        console.error("Erro Gemini Solução:", erro.response?.data || erro);
        res.status(500).json({
            erro: "Erro ao obter solução",
            detalhe: erro.message
        });
    }
});

/* ============================================
    RANKING
============================================ */
app.get("/ranking", async (req, res) => {
    const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .order("pontuacao", { ascending: false })
        .order("xp", { ascending: false })
        .order("nivel", { ascending: false });

    if (error) {
        console.error("Erro ranking:", error);
        return res.status(500).json({ erro: "Falha ao buscar ranking" });
    }

    res.json(data);
});

/* ============================================
    DASHBOARD
============================================ */
app.get("/dashboard/acertos", async (req, res) => {
    const usuario_id = req.usuario_id;

    const { data } = await supabase
        .from("envios")
        .select("correta")
        .eq("usuario_id", usuario_id);

    let acertos = 0, erros = 0;

    data.forEach(e => e.correta ? acertos++ : erros++);

    res.json({ acertos, erros });
});

app.get("/dashboard/xp", async (req, res) => {
    const usuario_id = req.usuario_id;

    const { data } = await supabase
        .from("xp_hist")
        .select("xp, criado_em")
        .eq("usuario_id", usuario_id)
        .order("criado_em", { ascending: true });

    res.json(data);
});

app.get("/dashboard/envios", async (req, res) => {
    const usuario_id = req.usuario_id;

    const { data } = await supabase
        .from("envios")
        .select("*")
        .eq("usuario_id", usuario_id)
        .order("criado_em", { ascending: false })
        .limit(20);

    res.json(data);
});

/* ============================================
    START SERVER
============================================ */
app.listen(process.env.PORT || 3000, () =>
    console.log("🔥 BenJudge backend rodando em http://localhost:3000")
);