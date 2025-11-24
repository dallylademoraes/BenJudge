import * as dotenv from "dotenv";
dotenv.config({ override: true });

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

    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    // ======================
    // PROMPT DE AJUDA
    // ======================
    const promptAjuda = `
Você é um assistente de programação prestativo e didático.
Sua função é APENAS ajudar o usuário a entender o problema e a pensar na solução, sem dar a resposta direta.
NÃO forneça código ou a solução completa. Mantenha as respostas focadas no conceito e na lógica.
Seja o mais breve e direto possível, com no máximo 50 palavras.

PROBLEMA (para contexto):
${JSON.stringify(problema, null, 2)}

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
                // CORREÇÃO: Usando 'generationConfig' e limite para garantir que a resposta curta seja gerada
                generationConfig: {
                    maxOutputTokens: 1500
                }
            }
        );

        // Tentativa de obter o texto, que pode ser nulo se a resposta for bloqueada
        const texto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        // NOVO LOG: Loga a resposta da API no servidor se o texto estiver vazio
        if (!texto) {
            console.error("Gemini retornou texto vazio ou bloqueado. Resposta da API:", JSON.stringify(resposta.data, null, 2));
        }

        const respostaFinal = texto || "Erro ao obter ajuda do Gemini. (Verifique o log do servidor para detalhes.)";

        res.json({
            resposta: respostaFinal
        });

    } catch (erro) {
        // Log detalhado para erros de conexão ou 4xx/5xx da API
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
        // ======================
        // CHAMADA AO GEMINI (modelo gemini-2.5-flash)
        // ======================
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
            XP GANHO
        ====================== */
        let xp_ganho = correta ? 50 : 10;

        const { data: tentativas } = await supabase
            .from("envios")
            .select("*")
            .eq("usuario_id", usuario_id)
            .eq("problema_id", problema_id);

        if (!tentativas || tentativas.length === 0) xp_ganho += 30;

        /* ======================
            SALVAR ENVIO
        ====================== */
        await supabase.from("envios").insert({
            usuario_id,
            problema_id,
            resposta: resposta_usuario,
            correta,
            nota: correta ? 10 : 0
        });

        /* ======================
            ATUALIZAR XP
        ====================== */
        await supabase.rpc("incrementar_xp", {
            usuario_id_param: usuario_id,
            quantidade: xp_ganho
        });

        /* ======================
            ATUALIZAR PONTUAÇÃO
        ====================== */
        if (correta) {
            await supabase.rpc("incrementar_pontuacao", {
                usuario_id_param: usuario_id,
                quantidade: 1
            });
        }

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
    const { problema_id, resposta_usuario } = req.body; // Recebe o código atual do usuário
    
    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    // ======================
    // PROMPT SOLUÇÃO E COMPARAÇÃO (CORRIGIDO PARA FORMATO JSON OBRIGATÓRIO)
    // ======================
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
                    // Limite alto para acomodar o objeto JSON, o código da solução e a análise
                    maxOutputTokens: 2500 
                }
            }
        );
        
        // Novo: Tenta analisar a resposta como JSON
        const textoBruto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        // Expressão regular para encontrar o primeiro objeto JSON completo na resposta
        const jsonMatch = textoBruto ? textoBruto.match(/\{[\s\S]*\}/) : null;
        
        if (!jsonMatch) {
            console.error("Gemini não retornou o objeto JSON formatado. Resposta bruta:", textoBruto);
            return res.status(500).json({ erro: "Erro de formatação do Gemini (Esperado JSON)." });
        }
        
        // Tenta fazer o parsing do JSON encontrado
        let dados;
        try {
            dados = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("Erro ao fazer parsing do JSON:", e);
            return res.status(500).json({ erro: "Erro de parsing do JSON do Gemini." });
        }
        
        // Envia dados separados para o frontend
        res.json({
            solucao: dados.solucao_codigo, // Código para o Monaco Editor
            analise: dados.analise // Texto para o container de análise
        });

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
app.listen(3000, () =>
    console.log("🔥 BenJudge backend rodando em http://localhost:3000")
);