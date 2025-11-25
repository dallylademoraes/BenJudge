import * as dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import fs from "fs";
import axios from "axios";
import cookieParser from "cookie-parser";
import { createClient } from "@supabase/supabase-js";

// --- Variáveis de Inicialização ---
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

/* ============================================
    CACHE EM MEMÓRIA
============================================ */
const apiCache = {}; 
const CACHE_EXPIRATION_TIME = 3600000; 

const cacheKey = (endpoint, problema_id, content = '') => 
    `${endpoint}_${problema_id}_${content.slice(0, 50).replace(/\s/g, '_')}`;

const cacheCheck = (key, res) => {
    const entry = apiCache[key];
    if (entry && (Date.now() < entry.expires)) {
        console.log(`[CACHE HIT] Retornando resposta para ${key}`);
        res.json(entry.data);
        return true;
    }
    return false;
};

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
    LISTAR PROBLEMAS (COM CHECK DE RESOLVIDO)
============================================ */
app.get("/problemas", async (req, res) => {
    try {
        // 1. Busca no banco quais problemas esse usuário já acertou
        const { data: acertos, error } = await supabase
            .from("envios")
            .select("problema_id")
            .eq("usuario_id", req.usuario_id)
            .eq("correta", true);

        if (error) throw error;

        // 2. Cria um conjunto (Set) de IDs resolvidos para busca rápida
        // (Set é melhor que Array para verificar 'has')
        const idsResolvidos = new Set(acertos.map(item => item.problema_id));

        // 3. Mapeia a lista original adicionando a flag 'resolvido'
        const problemasComStatus = problemas.map(p => ({
            ...p,
            resolvido: idsResolvidos.has(p.id) // true se estiver no set, false se não
        }));

        res.json(problemasComStatus);

    } catch (err) {
        console.error("Erro ao listar problemas com status:", err);
        // Se der erro no banco, retorna a lista sem o status para não quebrar o app
        res.json(problemas); 
    }
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

    if (cacheCheck(cacheKeyChat, res)) return;

    const problema = problemas.find(p => p.id === problema_id);
    if (!problema)
        return res.status(404).json({ erro: "Problema não encontrado" });

    const promptAjuda = `
Você é um assistente de programação prestativo e didático.
Sua função é APENAS ajudar o usuário a entender o problema e a pensar na solução, sem dar a resposta direta.
NÃO forneça código ou a solução completa. Mantenha as respostas focadas no conceito e na lógica.
Seja o mais breve e direto possível, com no máximo 50 palavras.

PROBLEMA (foco na descrição):
${problema.descricao}

PERGUNTA DO USUÁRIO:
${pergunta}
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: promptAjuda }] }],
                generationConfig: { maxOutputTokens: 1500 }
            }
        );

        const texto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        const respostaFinal = texto || "Erro ao obter ajuda do Gemini.";
        const responseData = { resposta: respostaFinal };
        
        cacheStore(cacheKeyChat, responseData);
        res.json(responseData);

    } catch (erro) {
        console.error("Erro no Gemini Chat:", erro.response?.data || erro);
        res.status(500).json({ erro: "Erro ao consultar Gemini para ajuda", detalhe: erro.message });
    }
});

/* ============================================
    CORRIGIR SOLUÇÃO (GEMINI 2)
============================================ */
app.post("/corrigir", async (req, res) => {
    const { problema_id, resposta_usuario, complexidade_usuario } = req.body;
    const usuario_id = req.usuario_id;

    const problema = problemas.find(p => p.id === problema_id);
    if (!problema) return res.status(404).json({ erro: "Problema não encontrado" });

    const promptSeguro = `
Você é um professor rigoroso de Análise de Algoritmos.
Avalie:
1. A CORREÇÃO funcional do código.
2. A ANÁLISE DE COMPLEXIDADE fornecida.

Dados:
- Problema: ${JSON.stringify(problema, null, 2)}
- Código do Aluno: ${resposta_usuario}
- Complexidade estimada: ${complexidade_usuario}

Retorne formato curto:
- Veredito do Código: "Correto" ou "Incorreto"
- Veredito da Complexidade: "Correta" ou "Incorreta" (A real é X)
- Nota: 0 a 10.
- Justificativa: Breve explicação.
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: promptSeguro }] }] }
        );

        const texto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text || "Erro Gemini.";
        const codigoCorreto = texto.toLowerCase().includes("veredito do código: correto");
        const complexidadeCorreta = texto.toLowerCase().includes("veredito da complexidade: correta");

        let xp_ganho = 0;
        if (codigoCorreto) {
            xp_ganho += 30; 
            if (complexidadeCorreta) xp_ganho += 20;
        } else {
            xp_ganho += 5;
        }

        const { data: tentativas } = await supabase
            .from("envios").select("*").eq("usuario_id", usuario_id).eq("problema_id", problema_id);

        if ((!tentativas || tentativas.length === 0) && codigoCorreto) xp_ganho += 20;

        await supabase.from("envios").insert({
            usuario_id,
            problema_id,
            resposta: resposta_usuario,
            correta: codigoCorreto,
            nota: (codigoCorreto && complexidadeCorreta) ? 10 : (codigoCorreto ? 7 : 0)
        });

        await supabase.rpc("incrementar_xp", { usuario_id_param: usuario_id, quantidade: xp_ganho });

        if (codigoCorreto) {
            await supabase.rpc("incrementar_pontuacao", { usuario_id_param: usuario_id, quantidade: 1 });
        }

        res.json({ avaliacao: texto, correta: codigoCorreto, xp_ganho });

    } catch (erro) {
        console.error("Erro Gemini:", erro);
        res.status(500).json({ erro: "Erro ao consultar Gemini", detalhe: erro.message });
    }
});

/* ============================================
    REVELAR SOLUÇÃO (GEMINI 3)
============================================ */
app.post("/revelar-solucao", async (req, res) => {
    const { problema_id, resposta_usuario } = req.body; 
    const cacheKeySolucao = cacheKey('solucao', problema_id);
    
    if (cacheCheck(cacheKeySolucao, res)) return; 
    
    const problema = problemas.find(p => p.id === problema_id);
    if (!problema) return res.status(404).json({ erro: "Problema não encontrado" });

    const promptSolucao = `
Você é um tutor. Forneça a solução ideal e compare com o aluno.
Retorne EXATAMENTE UM JSON com duas chaves:
1. "analise": Explicação concisa (max 150 palavras).
2. "solucao_codigo": Solução ideal em Python.

PROBLEMA: ${JSON.stringify(problema, null, 2)}
CÓDIGO ALUNO: ${resposta_usuario || "Não submetido."}
`;

    try {
        const resposta = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: promptSolucao }] }],
                generationConfig: { maxOutputTokens: 2500 }
            }
        );
        
        const textoBruto = resposta.data.candidates?.[0]?.content?.parts?.[0]?.text;
        const jsonMatch = textoBruto ? textoBruto.match(/\{[\s\S]*\}/) : null;
        
        if (!jsonMatch) throw new Error("JSON não encontrado na resposta");
        
        let dados = JSON.parse(jsonMatch[0]);
        const responseData = { solucao: dados.solucao_codigo, analise: dados.analise };

        cacheStore(cacheKeySolucao, responseData);
        res.json(responseData);

    } catch (erro) {
        console.error("Erro Solução:", erro);
        res.status(500).json({ erro: "Erro ao obter solução", detalhe: erro.message });
    }
});

/* ============================================
    ROTAS DE DADOS
============================================ */
app.get("/ranking", async (req, res) => {
    const { data, error } = await supabase.from("usuarios").select("*").order("pontuacao", { ascending: false });
    if (error) return res.status(500).json({ erro: "Falha ranking" });
    res.json(data);
});

app.get("/dashboard/acertos", async (req, res) => {
    const { data } = await supabase.from("envios").select("correta").eq("usuario_id", req.usuario_id);
    let acertos = 0, erros = 0;
    data.forEach(e => e.correta ? acertos++ : erros++);
    res.json({ acertos, erros });
});

app.get("/dashboard/xp", async (req, res) => {
    const { data } = await supabase.from("xp_hist").select("xp, criado_em").eq("usuario_id", req.usuario_id).order("criado_em", { ascending: true });
    res.json(data);
});

app.get("/dashboard/envios", async (req, res) => {
    const { data } = await supabase.from("envios").select("*").eq("usuario_id", req.usuario_id).order("criado_em", { ascending: false }).limit(20);
    res.json(data);
});

app.listen(process.env.PORT || 3000, () => console.log("🔥 BenJudge rodando..."));