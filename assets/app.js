/* Espanha na Moral — cadastro e download do eBook.
   Sem cookies e sem armazenamento no aparelho: o token do download fica só na memória da página. */
(function () {
  "use strict";
  var C = window.EM_CONFIG || {};
  var configurado = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  var inicio = Date.now();
  var token = null;

  // Origem da visita: UTMs do link + domínio de referência (sem dados pessoais)
  var q = new URLSearchParams(location.search);
  var origem = {
    utm_source: (q.get("utm_source") || "").slice(0, 100) || null,
    utm_medium: (q.get("utm_medium") || "").slice(0, 100) || null,
    utm_campaign: (q.get("utm_campaign") || "").slice(0, 100) || null,
    referencia: null
  };
  try { if (document.referrer) { var h = new URL(document.referrer).hostname; if (h !== location.hostname) origem.referencia = h.slice(0, 200); } } catch (e) {}

  function rpc(nome, corpo, timeoutMs) {
    if (!configurado) return Promise.reject(new Error("nao_configurado"));
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
    return fetch(C.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + nome, {
      method: "POST", signal: ctrl.signal, keepalive: true,
      headers: { "Content-Type": "application/json", "apikey": C.SUPABASE_ANON_KEY, "Authorization": "Bearer " + C.SUPABASE_ANON_KEY },
      body: JSON.stringify(corpo)
    }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("http_" + r.status); return r.json(); });
  }
  function evento(tipo) {
    return rpc("registrar_evento", { p_tipo: tipo, p_token: token, p_utm_source: origem.utm_source, p_utm_campaign: origem.utm_campaign, p_referencia: origem.referencia }, 5000)
      .catch(function () { /* métricas nunca bloqueiam o visitante */ });
  }

  // 1) visita (anônima)
  evento("visita");

  // 2) formulário
  var form = document.getElementById("form");
  var alerta = document.getElementById("alerta");
  var btn = document.getElementById("enviar");
  var reEmail = /^[^\s@<>]+@[^\s@<>]+\.[a-zA-Z]{2,}$/;

  ["nome", "email"].forEach(function (n) {
    form[n].addEventListener("input", function () { document.getElementById("c-" + n).classList.remove("erro"); });
  });
  function marcaErro(id, erro) { document.getElementById(id).classList.toggle("erro", erro); }
  function mostraAlerta(msg) { alerta.textContent = msg; alerta.classList.add("on"); }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    alerta.classList.remove("on");
    var nome = form.nome.value.replace(/\s+/g, " ").trim();
    var email = form.email.value.trim();
    var nomeOk = nome.length >= 1 && nome.length <= 60 && !/[<>{}\\/@0-9]/.test(nome);
    var emailOk = reEmail.test(email) && email.length <= 254;
    marcaErro("c-nome", !nomeOk); marcaErro("c-email", !emailOk);
    if (!nomeOk) { form.nome.focus(); return; }
    if (!emailOk) { form.email.focus(); return; }

    var tempo = Date.now() - inicio;
    btn.disabled = true; btn.textContent = "Liberando…";
    var mk = form.marketing.checked;

    rpc("registrar_lead", {
      p_nome: nome, p_email: email, p_situacao: form.situacao.value || null,
      p_marketing: mk, p_marketing_texto: mk ? (C.TEXTO_MARKETING || document.getElementById("texto-marketing").textContent) : null,
      p_politica_versao: C.POLITICA_VERSAO || "", p_utm_source: origem.utm_source, p_utm_medium: origem.utm_medium,
      p_utm_campaign: origem.utm_campaign, p_referencia: origem.referencia,
      p_armadilha: form.site.value, p_tempo_ms: tempo
    }, 10000).then(function (r) {
      if (r && r.ok) { token = r.token; return liberar(nome); }
      var msg = { email: "Confira o e-mail digitado.", nome: "Confira o nome digitado.",
                  limite: "Muitas tentativas a partir desta conexão. Aguarde um pouco e tente de novo.",
                  verificacao: "Não conseguimos confirmar o envio. Aguarde alguns segundos e tente novamente." }[r && r.erro] || "Não foi possível concluir. Tente novamente.";
      if (r && r.erro === "email") marcaErro("c-email", true);
      if (r && r.erro === "nome") marcaErro("c-nome", true);
      mostraAlerta(msg); btn.disabled = false; btn.textContent = "Quero meu eBook gratuito";
    }).catch(function () {
      // Falha de rede/servidor: o download NÃO é bloqueado (apenas não será contabilizado)
      liberar(nome);
    });
  });

  function liberar(nome) {
    form.style.display = "none";
    document.getElementById("nome-ok").textContent = nome + "!";
    document.getElementById("obrigado").classList.add("on");
    document.getElementById("link-direto").href = C.PDF_URL;
    document.getElementById("cadastro").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 3) download: registra o clique, baixa o arquivo inteiro e só então registra "download concluído"
  var bDl = document.getElementById("baixar");
  var barra = document.getElementById("progresso");
  var status = document.getElementById("status-dl");
  var nomeArquivo = "Morar-na-Espanha_Espanha-na-Moral.pdf";

  document.getElementById("link-direto").addEventListener("click", function () { if (token) evento("clique_download"); });

  // Navegadores internos (Instagram/Facebook) costumam bloquear downloads gerados pela página:
  // nesses casos abrimos o PDF diretamente no leitor do app.
  var navegadorInterno = /Instagram|FBAN|FBAV|FB_IAB|Threads/i.test(navigator.userAgent || "");

  bDl.addEventListener("click", function () {
    if (token) evento("clique_download");
    if (navegadorInterno) {
      status.textContent = "Abrindo o PDF… Para salvar, toque em ••• e escolha “Abrir no navegador”.";
      setTimeout(function () { window.location.href = C.PDF_URL; }, 350);
      return;
    }
    bDl.disabled = true; status.className = "status-dl"; status.textContent = "Baixando…";
    barra.classList.add("on"); barra.firstElementChild.style.width = "0";
    baixarComProgresso(C.PDF_URL).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = nomeArquivo;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      barra.firstElementChild.style.width = "100%";
      status.className = "status-dl ok"; status.textContent = "Pronto! O eBook foi baixado. Confira seus downloads.";
      bDl.disabled = false; bDl.textContent = "Baixar de novo";
      if (token) evento("download_concluido");
    }).catch(function () {
      // Plano B: abre o PDF direto
      status.textContent = "Abrindo o PDF…"; bDl.disabled = false;
      window.location.href = C.PDF_URL;
    });
  });

  function baixarComProgresso(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http_" + r.status);
      var total = +r.headers.get("Content-Length") || 0;
      if (!r.body || !total || !window.ReadableStream) return r.blob();
      var lido = 0, leitor = r.body.getReader(), partes = [];
      function passo() {
        return leitor.read().then(function (x) {
          if (x.done) return new Blob(partes, { type: "application/pdf" });
          partes.push(x.value); lido += x.value.length;
          barra.firstElementChild.style.width = Math.min(100, Math.round(lido / total * 100)) + "%";
          return passo();
        });
      }
      return passo();
    });
  }
})();
